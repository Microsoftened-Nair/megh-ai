const axios = require('axios');
const fs = require('fs');
const officeToPdf = require('office-to-pdf');
const PDFDocument = require('pdfkit');
const sharp = require('sharp');
const ytdl = require('@distube/ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');

// Set ffmpeg path
ffmpeg.setFfmpegPath(ffmpegPath);

// Move LLM logic here so it can be reloaded
// Move LLM logic here so it can be reloaded
async function detectIntent(text) {
  if (!text) return null;
  // Pre-filter: if text is very short (e.g. "lol") or just a greeting, skip LLM to save time/cost
  if (text.length < 4 && !text.toLowerCase().match(/pdf|doc|img|jpg|png|pic/)) return null;

  try {
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'meta-llama/llama-3.3-70b-instruct', // Faster than 120B, smarter than 8B
        messages: [
          { 
            role: 'system', 
            content: `You are an intent classifier. Analyze the user's message and identify if they want to perform a file conversion.
Available intents:
- "word-to-pdf": Convert a Word document to PDF. Key phrases: 'word to pdf', 'convert this doc', 'docx to pdf'.
- "combine-images-to-pdf": Combine multiple images into one PDF. Key phrases: 'combine images', 'merge these photos', 'images to pdf'.
- "combine-images-to-pdf": Combine multiple images into one PDF. Key phrases: 'combine images', 'merge these photos', 'images to pdf'.
- "image-to-pdf": Convert a single image to PDF. Key phrases: 'image to pdf', 'convert this photo', 'jpg to pdf'.
- "youtube-mp3": Download YouTube audio. Key phrases: 'youtube to mp3', 'audio from this video', 'send song', 'download mp3' + YouTube link.
- "youtube-mp4": Download YouTube video. Key phrases: 'youtube to mp4', 'download this video', 'send video', 'save video' + YouTube link.

Return ONLY the intent string (e.g., "word-to-pdf"). 
CRITICAL RULE:
- For YouTube: If user sends a link and says "mp3", "audio", or "song", return "youtube-mp3".
- If user sends a link and says "video", "mp4", or just "download this", return "youtube-mp4".
- Do NOT return a conversion intent just because a file is attached.
- Only return an intent if the user EXPLICITLY asks for a conversion in text (e.g. "convert this", "make pdf", "to pdf").
- If the user sends an image with no caption or just "look at this", return "null".
- If the text is unrelated to conversion (e.g. "cool pic", "what do you think"), return "null".

If no specific conversion intent is detected, look at the context implies a conversion request return the most likely intent, otherwise return "null". Do not add any explanation, quotes or punctuation.` 
          },
          { role: 'user', content: text }
        ]
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 8000 // Increased timeout
      }
    );
    const intent = response.data.choices[0].message.content.trim().toLowerCase().replace(/['"]/g, '');
    const validIntents = ['word-to-pdf', 'combine-images-to-pdf', 'image-to-pdf'];
    if (validIntents.includes(intent)) {
      console.log(`🤖 LLM detected intent: ${intent} from text: "${text}"`);
      return intent;
    }
    return null;
  } catch (err) {
    console.error('Intent classification error:', err.message);
    return null; 
  }
}

async function queryGemma(history) {
  try {
    // Read the system prompt fresh on every request
    const systemPrompt = fs.readFileSync('./system-prompt.txt', 'utf-8');
    
    // Construct messages array: System Prompt + Chat History
    const messages = [
        { role: 'system', content: systemPrompt },
        ...history
    ];

    const response = await axios.post(  
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'openai/gpt-oss-120b',
        messages: messages
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data.choices[0].message.content.trim();
  } catch (err) {
    console.error('Gemma API error:', err.response?.data || err.message);
    return 'my bad something is wrong with megh-ai, tell that nigga megh to fix his errors';
  }
}

// Track reply time in module scope? 
// If module is reloaded, this resets. It's acceptable for development.
let lastReplyTime = 0; 

module.exports = async function handleMessage(client, message, userPngBuffers, conversationHistory = {}) {
    const body = message.body.toLowerCase();
    const now = Date.now();

    // Ensure history exists for this user (safety check)
    if (!conversationHistory[message.from]) {
        conversationHistory[message.from] = [];
    }

    // Enhanced intent detection
    let intent = null;
    if (message.caption) intent = await detectIntent(message.caption);
    if (!intent) intent = await detectIntent(body);

    // Helper: is this message an image (even if sent as document)?
    function isImageMessage(msg) {
      const imageExts = ['.png', '.jpg', '.jpeg', '.bmp', '.gif', '.webp'];
      if (msg.type === 'image') return true;
      if (msg.type === 'document' && msg.mimetype && msg.mimetype.startsWith('image/')) return true;
      if (msg.filename) {
        const lower = msg.filename.toLowerCase();
        return imageExts.some(ext => lower.endsWith(ext));
      }
      return false;
    }

    // Helper: get media data with proper type handling and better error handling
    async function getMediaData(msg) {
      try {
        let mediaData;
        
        console.log('Getting media data for message type:', msg.type);
        console.log('Message mimetype:', msg.mimetype);
        console.log('Message filename:', msg.filename);
        
        // Get the raw media data with retry and timeout
        const decryptWithRetry = async (retries = 3) => {
          for (let i = 0; i < retries; i++) {
            try {
              // Race between decrypt and a timeout
              return await Promise.race([
                client.decryptMedia(msg),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Decrypt timeout')), 15000))
              ]);
            } catch (err) {
              if (i === retries - 1) throw err;
              console.log(`Decrypt failed (attempt ${i + 1}), retrying...`);
              await new Promise(r => setTimeout(r, 1000));
            }
          }
        };

        try {
          mediaData = await decryptWithRetry();
        } catch (decryptErr) {
          console.error('Final decryption failure:', decryptErr.message);
          throw new Error('Failed to download media. Please try again.');
        }

        if (!mediaData) {
          throw new Error('No media data found');
        }

        // Convert to buffer if it's base64
        let buffer;
        if (typeof mediaData === 'string') {
          // Remove data URL prefix if present
          const base64Data = mediaData.replace(/^data:image\/[a-z]+;base64,/, '');
          buffer = Buffer.from(base64Data, 'base64');
        } else if (Buffer.isBuffer(mediaData)) {
          buffer = mediaData;
        } else {
          buffer = Buffer.from(mediaData);
        }

        console.log('Buffer size:', buffer.length);

        // Create a temporary file with proper extension
        const tempPath = `./temp_${Date.now()}_${Math.random().toString(36).substring(7)}.tmp`;
        
        try {
          // Write buffer to temp file
          fs.writeFileSync(tempPath, buffer);
          
          // Try to process with Sharp directly from buffer first
          let processedBuffer;
          try {
            // First attempt: process directly from buffer
            processedBuffer = await sharp(buffer)
              .rotate() // Auto-rotate based on EXIF
              .jpeg({ quality: 95 }) // Convert to JPEG with high quality
              .toBuffer();
          } catch (bufferError) {
            console.log('Direct buffer processing failed, trying file method:', bufferError.message);
            
            // Second attempt: process from file
            processedBuffer = await sharp(tempPath)
              .rotate() // Auto-rotate based on EXIF
              .jpeg({ quality: 95 }) // Convert to JPEG with high quality
              .toBuffer();
          }
          
          // Clean up temp file
          if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath);
          }
          
          return processedBuffer;
          
        } catch (sharpError) {
          console.log('Sharp processing failed, trying alternative method:', sharpError.message);
          
          // Clean up temp file
          if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath);
          }
          
          // Fallback: try to use the raw buffer if Sharp fails
          // This might work for some formats that Sharp has trouble with initially
          try {
            // Try creating a new Sharp instance with different options
            const fallbackBuffer = await sharp(buffer, { 
              failOnError: false, 
              density: 300,
              limitInputPixels: false 
            })
            .rotate()
            .jpeg({ quality: 95, progressive: true })
            .toBuffer();
            
            return fallbackBuffer;
          } catch (fallbackError) {
            console.error('All processing methods failed:', fallbackError.message);
            
            // Last resort: return the original buffer and let PDFKit handle it
            // PDFKit might be able to process formats that Sharp cannot
            return buffer;
          }
        }
        
      } catch (err) {
        console.error('Media processing error:', err);
        throw new Error(`Failed to process media: ${err.message}`);
      }
    }

    // Auto-collect ALL images for potential PDF conversion (no intent required)
    if (isImageMessage(message)) {
      try {
        const imageBuffer = await getMediaData(message);
        
        if (!userPngBuffers[message.from]) userPngBuffers[message.from] = [];
        userPngBuffers[message.from].push(imageBuffer);
        
        console.log(`📸 Image collected for ${message.from}. Total images: ${userPngBuffers[message.from].length}`);
        // No reply here - just silently collect the image
      } catch (err) {
        console.error('Auto image collection error:', err);
        // Don't send error message for auto-collection, just log it
      }
    }

    // File conversion logic
    if ((message.type === 'image' || message.type === 'document') && intent) {
      // Word to PDF - FIXED VERSION
      if (intent === 'word-to-pdf') {
        if (message.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || 
            message.mimetype === 'application/msword') {
          
          try {
            console.log('Processing Word document...');
            
            // Get the actual document data using the same method as images
            let documentData;
             const decryptWithRetry = async (retries = 3) => {
              for (let i = 0; i < retries; i++) {
                try {
                  return await Promise.race([
                    client.decryptMedia(message),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Decrypt timeout')), 15000))
                  ]);
                } catch (err) {
                  if (i === retries - 1) throw err;
                  console.log(`Document decrypt failed (attempt ${i + 1}), retrying...`);
                  await new Promise(r => setTimeout(r, 1000));
                }
              }
            };

            try {
               documentData = await decryptWithRetry();
            } catch (err) {
               throw new Error('Failed to download document. Please try again.');
            }
            
            if (!documentData) {
              throw new Error('No document data found');
            }

            // Convert to buffer properly
            let buffer;
            if (typeof documentData === 'string') {
              // Remove data URL prefix if present and convert from base64
              const base64Data = documentData.replace(/^data:[^;]+;base64,/, '');
              buffer = Buffer.from(base64Data, 'base64');
            } else if (Buffer.isBuffer(documentData)) {
              buffer = documentData;
            } else {
              buffer = Buffer.from(documentData);
            }

            console.log('Document buffer size:', buffer.length);

            if (buffer.length === 0) {
              throw new Error('Document buffer is empty');
            }

            // Convert to PDF
            await client.sendText(message.from, 'holup converting word to pdf');
            
            const pdfBuffer = await officeToPdf(buffer);
            
            if (!pdfBuffer || pdfBuffer.length === 0) {
              throw new Error('PDF conversion resulted in empty buffer');
            }

            console.log('PDF buffer size:', pdfBuffer.length);
            
            const outPath = `./converted_${Date.now()}.pdf`;
            fs.writeFileSync(outPath, pdfBuffer);
            
            await client.sendFile(message.from, outPath, 'converted.pdf', 'here');
            fs.unlinkSync(outPath);
            
          } catch (err) {
            console.error('Word to PDF conversion error:', err);
            await client.sendText(message.from, `Conversion failed: ${err.message}. Please make sure you sent a valid Word document.`);
          }
        } else {
          await client.sendText(message.from, 'send a valid Word document (.doc or .docx) for Word to PDF conversion.');
        }
        return;
      }
      
      // Any image to PDF (single image, including images sent as document)
      // IMPORTANT: Only trigger if the intent matches EXACTLY 'image-to-pdf'
      // This prevents the bot from converting random images sent during chat or for 'combine' intent
      if (intent === 'image-to-pdf' && isImageMessage(message)) {
        try {
          // For single image conversion, we prefer the current message's image
          let imageBuffer;
          
          // Check if the current message has media that we can use
          try {
             // If the trigger message itself is the image
             imageBuffer = await getMediaData(message);
          } catch (e) {
             // If not (e.g. caption on a text reply), fallback to the last buffered image
             const buffers = userPngBuffers[message.from];
             if (buffers && buffers.length > 0) {
                imageBuffer = buffers[buffers.length - 1];
             }
          }

          if (!imageBuffer) {
            await client.sendText(message.from, 'No images found. Please send an image first.');
            return;
          }
          
          // Try to get metadata, with fallback for unknown formats
          let metadata;
          try {
            metadata = await sharp(imageBuffer).metadata();
          } catch (metadataError) {
            console.log('Could not get metadata with Sharp, using defaults:', metadataError.message);
            // Use default dimensions if Sharp can't read the metadata
            metadata = { width: 800, height: 600 }; // Default fallback dimensions
          }
          
          // A4 dimensions in points (72 points per inch)
          const A4_WIDTH = 595.28;
          const A4_HEIGHT = 841.89;
          
          // Calculate scaling to fit image on A4 while preserving aspect ratio
          const scaleFactor = Math.min(
            (A4_WIDTH * 0.9) / metadata.width,
            (A4_HEIGHT * 0.9) / metadata.height
          );
          
          const imgDisplayWidth = metadata.width * scaleFactor;
          const imgDisplayHeight = metadata.height * scaleFactor;
          
          // Calculate position to center image on page
          const x = (A4_WIDTH - imgDisplayWidth) / 2;
          const y = (A4_HEIGHT - imgDisplayHeight) / 2;

          // Create PDF with high-quality settings
          const doc = new PDFDocument({
            size: 'A4',
            autoFirstPage: false,
            compress: false  // Disable compression for better quality
          });
          
          const outPath = `./converted_${Date.now()}.pdf`;
          const stream = fs.createWriteStream(outPath);
          doc.pipe(stream);
          
          // Add page with high-quality settings
          doc.addPage({
            size: 'A4',
            margin: 0
          });

          try {
            // Try to use the processed image buffer
            doc.image(imageBuffer, x, y, {
              width: imgDisplayWidth,
              height: imgDisplayHeight,
              align: 'center',
              valign: 'center'
            });
          } catch (pdfError) {
            console.log('PDFKit had trouble with processed buffer, trying original:', pdfError.message);
            
            // If PDFKit can't handle the processed buffer, get the original
            const originalBuffer = await client.decryptMedia(message);
            const rawBuffer = typeof originalBuffer === 'string' 
              ? Buffer.from(originalBuffer.replace(/^data:image\/[a-z]+;base64,/, ''), 'base64')
              : Buffer.isBuffer(originalBuffer) ? originalBuffer : Buffer.from(originalBuffer);
            
            doc.image(rawBuffer, x, y, {
              width: imgDisplayWidth,
              height: imgDisplayHeight,
              align: 'center',
              valign: 'center'
            });
          }
          
          doc.end();

          await new Promise((resolve, reject) => {
            stream.on('finish', resolve);
            stream.on('error', reject);
          });

          await client.sendFile(message.from, outPath, 'converted.pdf', 'there you go');
          fs.unlinkSync(outPath);

        } catch (err) {
          console.error('Image processing error:', err);
          await client.sendText(message.from, `There was an issue processing your image: ${err.message}. Please try sending the image again or try a different image format.`);
        }
        return;
      }
    }

    // Combine images to PDF (trigger)
    if (intent === 'combine-images-to-pdf') {
      const buffers = userPngBuffers[message.from];
      if (!buffers || buffers.length === 0) {
        await client.sendText(message.from, 'No images found for this session. Please send some images first, then ask me to convert them to PDF.');
        return;
      }

      await client.sendText(message.from, `holup ${buffers.length} images to PDF...`);

      // A4 dimensions in points (72 points per inch)
      const A4_WIDTH = 595.28;
      const A4_HEIGHT = 841.89;
      
      const doc = new PDFDocument({
        size: 'A4',
        autoFirstPage: false,
        compress: false  // Disable compression for better quality
      });
      
      const outPath = `./combined_${Date.now()}.pdf`;
      const stream = fs.createWriteStream(outPath);
      doc.pipe(stream);

      for (const buffer of buffers) {
        if (!buffer || buffer.length === 0) {
          continue; 
        }
        
        let metadata;
        try {
          metadata = await sharp(buffer).metadata();
        } catch (err) {
            console.log('Error getting metadata:', err.message);
            metadata = { width: 800, height: 600 };
        }

        // Process image to ensure best quality
        let image;
        try {
          image = await sharp(buffer)
            .withMetadata()
            .ensureAlpha()  
            .toFormat('png', { quality: 100 }) 
            .toBuffer();
        } catch (err) {
          image = buffer; 
        }

        // Calculate scaling
        const scaleFactor = Math.min(
          (A4_WIDTH * 0.9) / metadata.width,
          (A4_HEIGHT * 0.9) / metadata.height
        );
        
        const imgDisplayWidth = metadata.width * scaleFactor;
        const imgDisplayHeight = metadata.height * scaleFactor;
        
        const x = (A4_WIDTH - imgDisplayWidth) / 2;
        const y = (A4_HEIGHT - imgDisplayHeight) / 2;

        doc.addPage({
          size: 'A4',
          margin: 0
        });
        
        try {
          doc.image(image, x, y, {
            width: imgDisplayWidth,
            height: imgDisplayHeight,
            align: 'center',
            valign: 'center',
            quality: 1.0 
          });
        } catch (pdfError) {
          doc.image(buffer, x, y, {
            width: imgDisplayWidth,
            height: imgDisplayHeight,
            align: 'center',
            valign: 'center'
          });
        }
      }
      
      doc.end();
      stream.on('finish', async () => {
        await client.sendFile(message.from, outPath, 'combined.pdf', `here ${buffers.length} images combined!`);
        fs.unlinkSync(outPath);
        // Clear the images after successful conversion
        userPngBuffers[message.from] = [];
      });
      return;
    }

    // YouTube Download Logic
    if (intent === 'youtube-mp3' || intent === 'youtube-mp4') {
        const urlMatch = body.match(/(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/[^\s]+/);
        if (!urlMatch) {
            await client.sendText(message.from, "send a valid YouTube link.");
            return;
        }
        const url = urlMatch[0];

        await client.sendText(message.from, `holup downloading ${intent === 'youtube-mp3' ? 'audio' : 'video'}...`);

        try {
            // Validate video info first
            if (!ytdl.validateURL(url)) {
                throw new Error("Invalid YouTube URL");
            }

            const info = await ytdl.getInfo(url);
            const title = info.videoDetails.title.replace(/[^\w\s]/gi, '').substring(0, 50); // Sanitize title
            
            const timestamp = Date.now();
            const outputFormat = intent === 'youtube-mp3' ? 'mp3' : 'mp4';
            const outputPath = `./temp_${timestamp}.${outputFormat}`;

            // Download and Convert
            await new Promise((resolve, reject) => {
                const stream = ytdl(url, { 
                    quality: intent === 'youtube-mp3' ? 'highestaudio' : 'highest',
                    filter: intent === 'youtube-mp3' ? 'audioonly' : format => format.container === 'mp4'
                });

                let command = ffmpeg(stream);

                if (intent === 'youtube-mp3') {
                    command = command.audioBitrate(128).format('mp3');
                } else {
                     command = command.format('mp4'); // Ensure container is correct
                }

                command
                    .save(outputPath)
                    .on('end', resolve)
                    .on('error', (err) => {
                        console.error('FFmpeg error:', err);
                        reject(err);
                    });
            });
            
            // Check file size (WhatsApp limit is roughly 64MB for easy sending, though documents can be larger)
            const stats = fs.statSync(outputPath);
            const fileSizeInMB = stats.size / (1024 * 1024);
            
            if (fileSizeInMB > 100) {
                 await client.sendText(message.from, "File is too large (>100MB) to send via WhatsApp.");
                 fs.unlinkSync(outputPath);
                 return;
            }

            // Send file
            await client.sendFile(message.from, outputPath, `${title}.${outputFormat}`, `here's your ${outputFormat}`);
            
            // Cleanup
            fs.unlinkSync(outputPath);

        } catch (err) {
            console.error('YouTube download error:', err);
            await client.sendText(message.from, `Failed to download: ${err.message}. specific vids might be restricted or too long.`);
        }
        return;
    }

    // Default: LLM reply
    if (body.includes("megh-ai") && now - lastReplyTime > 5000) {
      lastReplyTime = now;
      await client.simulateTyping(message.from, true);
      
      // Get or init history
      if (!conversationHistory[message.from]) {
        conversationHistory[message.from] = [];
      }
      
      // Add user message to history
      conversationHistory[message.from].push({ role: 'user', content: message.body });
      
      // Keep history manageable (last 20 messages)
      if (conversationHistory[message.from].length > 20) {
        conversationHistory[message.from] = conversationHistory[message.from].slice(-20);
      }

      // Query LLM with history
      const reply = await queryGemma(conversationHistory[message.from]);
      
      // Add assistant reply to history
      conversationHistory[message.from].push({ role: 'assistant', content: reply });
      
      // Handle multi-message responses
      const parts = reply.split('|||').map(p => p.trim()).filter(p => p.length > 0);
      
      for (const part of parts) {
        const typingDuration = Math.min(2000, Math.max(500, part.length * 50));
        
        await client.simulateTyping(message.from, true);
        await new Promise(resolve => setTimeout(resolve, typingDuration));
        
        await client.sendText(message.from, part);
        
        if (parts.length > 1) {
             await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
    }
}

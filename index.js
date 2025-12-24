// Enhanced intent detection using simple NLP and LLM fallback
// Enhanced intent detection using LLM
async function detectIntent(text) {
  if (!text) return null;
  try {
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'meta-llama/llama-3.3-8b-instruct:free',
        messages: [
          { 
            role: 'system', 
            content: `You are an intent classifier. Analyze the user's message and identify if they want to perform a file conversion.
Available intents:
- "word-to-pdf": Convert a Word document to PDF. Key phrases: 'word to pdf', 'convert this doc', 'docx to pdf'.
- "combine-images-to-pdf": Combine multiple images into one PDF. Key phrases: 'combine images', 'merge these photos', 'images to pdf'.
- "image-to-pdf": Convert a single image to PDF. Key phrases: 'image to pdf', 'convert this photo', 'jpg to pdf'.

Return ONLY the intent string (e.g., "word-to-pdf"). If no specific conversion intent is detected, look at the context implies a conversion request return the most likely intent, otherwise return "null". Do not add any explanation, quotes or punctuation.` 
          },
          { role: 'user', content: text }
        ]
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 5000 // 5s timeout to avoid hanging
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

require('dotenv').config();
const { create } = require('@open-wa/wa-automate');
const axios = require('axios');
const fs = require('fs');
const officeToPdf = require('office-to-pdf');
const PDFDocument = require('pdfkit');
const sharp = require('sharp');

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
let lastReplyTime = 0;

// 👉 hold the system prompt in memory
let systemPrompt = fs.readFileSync('./system-prompt.txt', 'utf-8');

// 🔁 watch for changes and update live
fs.watchFile('./system-prompt.txt', (curr, prev) => {
  console.log('🔁 system prompt updated');
  systemPrompt = fs.readFileSync('./system-prompt.txt', 'utf-8');
});

async function queryGemma(prompt) {
  try {
    const response = await axios.post(  
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'meta-llama/llama-3.3-8b-instruct:free',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ]
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data.choices[0].message.content.trim();
  } catch (err) {
    console.error('Gemma API error:', err.response?.data || err.message);
    return 'Oops! Something went wrong while talking to Megh-AI.';
  }
}

create({
  sessionId: "megh-ai",
  multiDevice: true,
}).then(client => {
  console.log('🤖 Megh-AI is running...');
  // Store PNGs per user/session for group conversion
  const userPngBuffers = {};

  client.onMessage(async message => {
    const body = message.body.toLowerCase();
    const now = Date.now();

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
        
        // Get the raw media data
        mediaData = await client.decryptMedia(msg);

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
            console.log('Message type:', message.type);
            console.log('Mimetype:', message.mimetype);
            console.log('Filename:', message.filename);
            
            // Get the actual document data using the same method as images
            const documentData = await client.decryptMedia(message);
            
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
      if (intent === 'image-to-pdf' && isImageMessage(message)) {
        try {
          // For single image conversion, use the last image sent
          const buffers = userPngBuffers[message.from];
          if (!buffers || buffers.length === 0) {
            await client.sendText(message.from, 'No images found. Please send an image first.');
            return;
          }
          
          const imageBuffer = buffers[buffers.length - 1]; // Use the most recent image
          
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
      // Add more conversion types here as needed
    }

    // Combine images to PDF (trigger) - works with auto-collected images
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
      
      // Create PDF with high-quality settings
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
          continue; // skip empty/invalid images
        }
        
        let metadata;
        try {
          metadata = await sharp(buffer).metadata();
        } catch (err) {
          console.log('Could not get metadata for combined image, using defaults:', err.message);
          metadata = { width: 800, height: 600 }; // Default fallback dimensions
        }

        // Process image to ensure best quality
        let image;
        try {
          image = await sharp(buffer)
            .withMetadata()
            .ensureAlpha()  // Ensure proper alpha channel handling
            .toFormat('png', { quality: 100 })  // Convert to high quality PNG
            .toBuffer();
        } catch (err) {
          console.log('Could not process image for combining, using original:', err.message);
          image = buffer; // Use original buffer if processing fails
        }

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

        // Add page with high-quality settings
        doc.addPage({
          size: 'A4',
          margin: 0
        });
        
        try {
          // Use high-quality image rendering
          doc.image(image, x, y, {
            width: imgDisplayWidth,
            height: imgDisplayHeight,
            align: 'center',
            valign: 'center',
            quality: 1.0  // Maximum quality
          });
        } catch (pdfError) {
          console.log('PDFKit had trouble with processed image, trying original:', pdfError.message);
          // Try with original buffer if processed one fails
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

    // Default: LLM reply
    if (body.includes("megh-ai") && now - lastReplyTime > 5000) {
      lastReplyTime = now;
      await client.simulateTyping(message.from, true);
      const reply = await queryGemma(message.body);
      setTimeout(async () => {
        await client.sendText(message.from, reply);
      }, 2500);
    }
  });
});
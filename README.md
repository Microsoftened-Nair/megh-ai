# Megh-AI Bot

A WhatsApp bot powered by Llama 3.3 via OpenRouter and open-wa. Megh-AI is your chill, sarcastic friend who can chat, convert images to PDF, combine multiple images into a single PDF, and convert Word documents to PDF.

## Features

- 💬 **Chat with AI**: Mention `megh-ai` to get responses from Llama 3.3 with a sarcastic personality
- 🖼️ **Image to PDF**: Convert single images to PDF format
- 📚 **Combine Images to PDF**: Merge multiple images into a single PDF
- 📄 **Word to PDF**: Convert `.doc` and `.docx` files to PDF
- 🔄 **Live System Prompt**: Edit the system prompt and changes take effect immediately
- 🎯 **Intent Detection**: Automatically understands conversion requests based on natural language

## Prerequisites

Before installing, ensure you have:

- **Node.js** (v16 or higher) - [Download here](https://nodejs.org/)
- **npm** (comes with Node.js)
- An **OpenRouter API Key** - [Get one here](https://openrouter.ai/)
- A **WhatsApp account** for testing

## Installation

### 1. Clone or Download the Repository

```bash
git clone <repository-url>
cd megh-ai
```

Or if you already have the files, navigate to the project directory:

```bash
cd /home/megh/megh-ai
```

### 2. Install Dependencies

```bash
npm install
```

This will install all required packages:
- `@open-wa/wa-automate` - WhatsApp automation
- `axios` - HTTP client for API requests
- `dotenv` - Environment variable management
- `sharp` - Image processing
- `pdfkit` - PDF generation
- `office-to-pdf` - Word document conversion
- `jimp` - Additional image handling

### 3. Set Up Environment Variables

Create a `.env` file in the project root directory:

```bash
touch .env
```

Add your OpenRouter API key to the `.env` file:

```
OPENROUTER_API_KEY=your_api_key_here
```

**To get your OpenRouter API key:**
1. Visit [openrouter.ai](https://openrouter.ai/)
2. Sign up or log in
3. Go to your account settings
4. Copy your API key
5. Paste it in the `.env` file

### 4. Configure the System Prompt (Optional)

The `system-prompt.txt` file contains the personality and behavior instructions for Megh-AI. You can edit this file to customize the bot's responses.

Current personality: Chill, sarcastic friend with minimal slang, dry humor, and to-the-point responses.

To modify the personality, simply edit `system-prompt.txt` - changes will be loaded automatically while the bot is running.

## Usage

### Start the Bot

```bash
npm start
```

Or directly:

```bash
node index.js
```

You'll see the message:
```
🤖 Megh-AI is running...
```

### Using the Bot on WhatsApp

#### 1. Chat with Megh-AI

Mention the bot in any message:

```
@megh-ai what's the weather like?
```

Or simply text:

```
megh-ai tell me a joke
```

The bot will respond after a few seconds with a sarcastic reply.

#### 2. Convert Image to PDF

Send an image and mention it should be converted:

```
convert this image to pdf
```

or

```
image to pdf
```

The bot will convert the image to PDF and send it back.

#### 3. Combine Multiple Images to PDF

1. Send multiple images (one by one or together)
2. When ready, send a message like:

```
combine these images to pdf
```

or

```
merge all images to pdf
```

The bot will combine all collected images into a single PDF.

#### 4. Convert Word Document to PDF

Send a Word document (`.doc` or `.docx`) with a message:

```
convert this word to pdf
```

or

```
word to pdf
```

The bot will convert it to PDF and send it back.

## Project Structure

```
megh-ai/
├── index.js                 # Main bot logic and handlers
├── package.json             # Project dependencies and metadata
├── .env                     # Environment variables (create this)
├── system-prompt.txt        # AI personality and behavior configuration
├── megh-ai.data.json        # Bot session data
└── README.md                # This file
```

## How It Works

### Intent Detection

The bot uses pattern matching to detect user intent from messages:
- **Image to PDF**: Detects phrases like "image to pdf", "convert image to pdf"
- **Combine Images**: Detects phrases like "combine images", "merge images", "group images to pdf"
- **Word to PDF**: Detects phrases like "word to pdf", "convert word to pdf"
- **Chat**: Any message mentioning "megh-ai" triggers a response from Llama 3.3

### Image Processing

1. Images are automatically collected from the session
2. Sharp processes images for optimization (auto-rotation, quality adjustment)
3. PDFKit renders images on A4-sized pages, centering and scaling appropriately
4. Files are sent back to the user and cleaned up

### API Integration

- Uses OpenRouter's free tier API for Llama 3.3
- System prompt is sent with each message to maintain personality
- 5-second cooldown between bot responses to prevent spam

## Troubleshooting

### Bot Not Responding

1. **Check if it's running**: Make sure the bot is still running in your terminal
2. **Verify API Key**: Ensure your OpenRouter API key is correct in the `.env` file
3. **Check WhatsApp Connection**: The bot needs an active WhatsApp session. Log in when prompted

### PDF Conversion Issues

- **Images not converting**: Make sure the image format is supported (PNG, JPG, JPEG, GIF, BMP, WebP)
- **Word documents failing**: Ensure the file is a valid `.doc` or `.docx` file
- **Empty PDFs**: Check that the file wasn't corrupted during upload

### Memory Issues

If the bot crashes:
1. Clear collected images by restarting the bot
2. Check available system memory
3. Process images in smaller batches

## Development

### Adding New Conversion Types

1. Add intent detection pattern in the `detectIntent()` function
2. Implement handling logic in the `client.onMessage()` handler
3. Test with sample files

### Modifying the AI Personality

Edit `system-prompt.txt` to change how Megh-AI responds. The file supports:
- Custom tone and style
- Emoji preferences
- Response length and format
- Topic preferences (currently avoids politics, religion, and NSFW)

## Environment Details

- **OS**: Linux
- **Node.js**: v16+
- **NPM**: v7+

## License

This project is provided as-is. Feel free to modify and use for personal purposes.

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Verify all environment variables are set correctly
3. Ensure all dependencies are installed: `npm install`
4. Check WhatsApp connection status in the bot console

## Future Features

Planned improvements:
- [ ] Screenshot to PDF conversion
- [ ] Multiple document format support
- [ ] Message scheduling
- [ ] User preferences and settings
- [ ] Command help menu
- [ ] Rate limiting and usage stats

---

**Enjoy chatting with Megh-AI!** 🤖

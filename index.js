require('dotenv').config();
const { create } = require('@open-wa/wa-automate');
const path = require('path');

// Location of the hot-reloadable handler
const HANDLER_PATH = path.resolve(__dirname, 'messageHandler.js');

create({
  sessionId: "megh-ai",
  multiDevice: true,
}).then(client => {
  console.log('🤖 Megh-AI is running with hot-reload enabled...');
  
  // Persistent state for image buffers
  const userPngBuffers = {};
  // Persistent state for chat history
  const conversationHistory = {};

  client.onMessage(async message => {
    try {
      // CLEAR CACHE: This forces Node to re-read the file from disk
      delete require.cache[require.resolve(HANDLER_PATH)];
      
      // Load the fresh handler
      const handleMessage = require(HANDLER_PATH);
      
      // Execute the handler with persistent state
      await handleMessage(client, message, userPngBuffers, conversationHistory);
      
    } catch (err) {
      console.error('CRITICAL ERROR in message handler:', err);
      // Fallback response if code breaks completely
      if (err.code === 'MODULE_NOT_FOUND') {
         console.error('Could not find messageHandler.js!');
      }
    }
  });
});
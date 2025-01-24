AI Assistant
=======

## Description

This project is an AI Assistant, which accepts audio input, provides audio output, and answers questions about the current weather in a requested location. It's built using React and Express js.

## Features

- **Real-Time Audio Interaction:** Speak to the assistant and receive immediate audio responses.
- **Weather Information:** Ask about the current weather in any location.
- **User-Friendly Interface:** Simple and intuitive React frontend with clear controls.
- **Scalable Backend:** Node.js server handling multiple simultaneous conversations via WebSockets.


## Installation

To set up this project locally, follow these steps:

1. Clone the repository:
   ```
   git clone https://github.com/SulimanSagindykov/AssistantAI.git
   ```
2. Navigate to the project directory:
   ```
   cd AssistanAI
   ```
3. Set Your OpenAI API Key:
   ```
   set your API Key in Server -> .env
   ```
3. Install dependencies:
   ```
   npm install react react-dom express cors dotenv openai
   ```
4. Start the server:
   ```
   node index.js
   ```  
5. Start the development server:
   ```
   npm start run
   ```
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import dotenv from 'dotenv';
import mic from 'mic';
import Speaker from 'speaker';
import { Readable } from 'stream';
import http from 'http';
import fetch from 'node-fetch';  // For making weather API calls

dotenv.config();
import cors from 'cors';

const PORT = process.env.PORT || 3001;
const API_KEY = process.env.OPENAI_API_KEY;
const WEBSOCKET_URL = `wss://api.openai.com/v1/realtime?model=gpt-4o-mini-realtime-preview-2024-12-17`;

// Express app
const app = express();
app.use(express.json());
app.use(cors());

let isCallActive = false;

app.get('/', (req, res) => {
    res.send('Backend is running');
});

app.post('/start-call', (req, res) => {
    if (!isCallActive) {
        isCallActive = true;
        console.log('Call started');
    }
    res.sendStatus(200);
});

app.post('/stop-call', (req, res) => {
    if (isCallActive) {
        isCallActive = false;
        console.log('Call stopped');
    }
    res.sendStatus(200);
});

// HTTP server from Express for the WebSocket
const server = http.createServer(app);

// WebSocket server that React app connects to
const wss = new WebSocketServer({ server });

// On each new connection from the frontend
wss.on('connection', (ws) => {
    console.log('Frontend client connected to backend WebSocket');

    // Initialize OpenAI Realtime WebSocket
    const openaiWs = new WebSocket(WEBSOCKET_URL, {
        headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'OpenAI-Beta': 'realtime=v1'
        }
    });

    const micInstance = mic({
        rate: '24000',
        channels: '1',
        fileType: 'wav'
    });
    const micInputStream = micInstance.getAudioStream();

    let speakerStream = null;
    let isPlaying = false;
    let audioQueue = [];
    let isResponding = false;
    let currentResponseId = null;
    let currentItemId = null;
    let audioPlaybackDuration = 0;


    openaiWs.on('open', () => {
        console.log('Connected to OpenAI Realtime API');
        setupSession();
        startListening(); // Start listening to mic as soon as session is open
    });

    openaiWs.on('message', (data) => {
        const event = JSON.parse(data);
        handleServerEvent(event, ws);
    });

    openaiWs.on('error', (error) => {
        console.error('OpenAI Realtime WS error:', error);
    });

    openaiWs.on('close', () => {
        console.log('Disconnected from OpenAI Realtime API');
        ws.close();
    });

    // Realtime Session
    function setupSession() {
        const sessionConfig = {
            event_id: 'event_setup_session',
            type: 'session.update',
            session: {
                modalities: ['text', 'audio'],
                instructions: `You are a helpful AI assistant. You can answer any questions and respond to greetings.
                
                Greetings: Always respond politely to greetings like "Hi," "Hello," or "Hey" with a friendly message.
                Weather Queries: If a user asks for the weather, you'll receive a system message with the result. Summarize it and respond with it.
        `,
                voice: 'echo',
                input_audio_format: 'pcm16',
                output_audio_format: 'pcm16',
                turn_detection: {
                    type: 'server_vad',
                    threshold: 0.5,
                    prefix_padding_ms: 500,
                    silence_duration_ms: 1000
                }
            }
        };
        openaiWs.send(JSON.stringify(sessionConfig));
    }

    function handleServerEvent(event, clientWs) {
        switch (event.type) {
            case 'session.created':
            case 'session.updated':
                console.log('Session configured.');
                break;
            case 'input_audio_buffer.speech_started':
                console.log('Speech detected');
                clientWs.send(JSON.stringify({ type: 'input_speech_started' }));
                if (isResponding) {
                    handleInterruption();
                }
                break;
            case 'input_audio_buffer.speech_stopped':
                console.log('Speech ended');
                clientWs.send(JSON.stringify({ type: 'input_speech_stopped' }));
                break;
            case 'response.created':
                console.log('Response generation started');
                isResponding = true;
                currentResponseId = event.response.id;
                clientWs.send(JSON.stringify({ type: 'response_created' }));
                break;
            case 'response.output_item.added':
                currentItemId = event.item.id;
                break;
            case 'response.audio.delta':
                queueAudioDelta(event.delta);
                break;
            case 'response.done':
                console.log('Response completed');
                clientWs.send(JSON.stringify({ type: 'response.done' }));
                isResponding = false;
                currentResponseId = null;
                currentItemId = null;
                audioPlaybackDuration = 0;
                startListening();
                break;
            case 'conversation.item.input_audio_transcription.completed':
                // The user’s audio is transcribed here
                console.log('User audio transcription completed:', event.transcript);
                clientWs.send(JSON.stringify({
                    type: 'conversation.item.input_audio_transcription.completed',
                    transcript: event.transcript
                }));

                // Check if user asked for weather
                handlePotentialWeatherQuery(event.transcript);

                break;
            case 'response.audio_transcript.delta':
                // Partial transcript of AI's response
                console.log('AI audio transcript delta:', event.delta);
                clientWs.send(JSON.stringify({
                    type: 'response.audio_transcript.delta',
                    delta: event.delta
                }));
                break;
            case 'response.audio_transcript.done':
                console.log('AI audio transcript completed');
                clientWs.send(JSON.stringify({
                    type: 'response.audio_transcript.done'
                }));
                break;
            case 'response.text.delta':
                console.log('AI text delta:', event.delta);
                clientWs.send(JSON.stringify({
                    type: 'response.text.delta',
                    delta: event.delta
                }));
                break;
            case 'error':
                console.error('OpenAI Realtime error event:', event.error);
                clientWs.send(JSON.stringify({
                    type: 'error',
                    error: event.error
                }));
                break;
            default:
                console.log('Unhandled event type:', event.type);
        }
    }

    function startListening() {
        // Only start mic if call is active
        if (!isCallActive) {
            console.log('Call is not active; ignoring mic start');
            return;
        }
        console.log('Listening for user input...');
        micInstance.start();
    }

    function stopListening() {
        console.log('Stopped listening.');
        micInstance.stop();
    }

    micInputStream.on('data', (chunk) => {
        // Only send audio if the call is active
        if (!isCallActive) return;
        console.log(`Sending audio chunk of size: ${chunk.length}`);
        openaiWs.send(JSON.stringify({
            event_id: `event_audio_${Date.now()}`,
            type: 'input_audio_buffer.append',
            audio: chunk.toString('base64')
        }));
    });

    // Audio Playback
    function queueAudioDelta(base64Audio) {
        audioQueue.push(Buffer.from(base64Audio, 'base64'));
        if (!isPlaying) {
            playNextAudio();
        }
    }

    function playNextAudio() {
        const audioChunk = audioQueue.shift();
        if (!audioChunk) {
            // Nothing to play
            isPlaying = false;
            return;
        }

        if (!speakerStream || speakerStream.destroyed) {
            speakerStream = new Speaker({
                channels: 1,
                bitDepth: 16,
                sampleRate: 24000
            });

            speakerStream.on('close', () => {
                console.log('Speaker stream closed');
                isPlaying = false;
                playNextAudio();
            });
        }

        isPlaying = true;
        const readableStream = new Readable({
            read() {
                this.push(audioChunk);
                this.push(null);
            }
        });

        readableStream.pipe(speakerStream, { end: false });
        readableStream.on('end', () => {
            audioPlaybackDuration += (audioChunk.length / 2) / 24000 * 1000;
            playNextAudio();
        });
    }

    // Interruption Handling
    function handleInterruption() {
        console.log('Interruption detected');

        // Clear audio queue and stop playback
        audioQueue = [];
        if (speakerStream && !speakerStream.destroyed) {
            speakerStream.end();
            speakerStream = null;
        }
        isPlaying = false;

        // Cancel the current response
        openaiWs.send(JSON.stringify({
            event_id: `event_cancel_${Date.now()}`,
            type: 'response.cancel'
        }));

        if (currentItemId) {
            openaiWs.send(JSON.stringify({
                event_id: `event_truncate_${Date.now()}`,
                type: 'conversation.item.truncate',
                item_id: currentItemId,
                content_index: 0,
                audio_end_ms: Math.floor(audioPlaybackDuration)
            }));
        }

        isResponding = false;
        currentResponseId = null;
        currentItemId = null;
        audioPlaybackDuration = 0;
    }

    async function handlePotentialWeatherQuery(transcript) {
        // Very simple check for "weather in ...", or "weather at ..."
        const match = transcript.match(/weather (?:in|at) ([A-Za-z\s]+)/i);
        if (match) {
            const city = match[1].trim();
            const weatherData = await fetchOpenMeteoWeather(city);
            console.log('Fetched weather data for:', city, weatherData);

            // Telling GPT we have some "knowledge" about the weather in that city
            const weatherMessage = formatWeatherMessage(weatherData, city);

            openaiWs.send(JSON.stringify({
                event_id: `event_weather_${Date.now()}`,
                type: 'conversation.item.add',
                item: {
                    role: 'system',
                    content: weatherMessage
                }
            }));
        }
    }

    async function fetchOpenMeteoWeather(city) {
        try {
            // 1) Geocode city -> lat/long
            const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`;
            const geoRes = await fetch(geoUrl);
            if (!geoRes.ok) {
                return { error: `Geocoding error. Server returned ${geoRes.status}` };
            }
            const geoData = await geoRes.json();
            if (!geoData.results || geoData.results.length < 1) {
                return { error: `Could not find location for city: ${city}` };
            }
            const { latitude, longitude } = geoData.results[0];

            // Fetch current weather
            const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`;
            const weatherRes = await fetch(weatherUrl);
            if (!weatherRes.ok) {
                return { error: `Weather API error. Server returned ${weatherRes.status}` };
            }
            const weatherJson = await weatherRes.json();
            return { ...weatherJson, city };
        } catch (error) {
            console.error('Error fetching Open-Meteo data:', error);
            return { error: error.message };
        }
    }

    // Format the weather data as a system message for GPT
    function formatWeatherMessage(weatherData, city) {
        if (weatherData.error) {
            return `Weather data error: ${weatherData.error}`;
        }
        const { current_weather } = weatherData;
        if (!current_weather) {
            return `No current weather data found for ${city}.`;
        }
        const { temperature, windspeed, weathercode, time } = current_weather;

        return `Open-Meteo weather data for ${city}:
- Temperature: ${temperature} °C
- Wind Speed: ${windspeed} km/h
- Weather Code: ${weathercode}
- Time: ${time}
(Use this info if the user asked about it.)`;
    }

    // Client Disconnection
    ws.on('close', () => {
        console.log('Frontend client disconnected');
        micInstance.stop();
        if (speakerStream) {
            speakerStream.end();
        }
        if (openaiWs.readyState === WebSocket.OPEN) {
            openaiWs.close();
        }
    });

    // Process Termination
    process.on('SIGINT', () => {
        console.log('Shutting down...');
        wss.clients.forEach((client) => {
            client.close();
        });
        server.close(() => {
            console.log('Server closed');
            process.exit(0);
        });
    });

    console.log('WebSocket connection established. Press Ctrl+C to exit.');
});

// Start the Express + WebSocket server
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
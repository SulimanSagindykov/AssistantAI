import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import "./App.css";

function App() {
    const [isCalling, setIsCalling] = useState(false);
    const wsRef = useRef(null);

    useEffect(() => {
        // WebSocket to the backend
        wsRef.current = new WebSocket("ws://localhost:3001");

        wsRef.current.onopen = () => {
            console.log("WebSocket connected to backend");
        };

        wsRef.current.onmessage = (message) => {
            // Handle any server-sent events
            const data = JSON.parse(message.data);
            if (data.type === "input_speech_started") {
                console.log("Speech started");
            } else if (data.type === "input_speech_stopped") {
                console.log("Speech stopped");
            } else if (data.type === "conversation.item.input_audio_transcription.completed") {
                console.log("User said:", data.transcript);
            } else if (data.type === "response.text.delta") {
                console.log("AI partial text delta:", data.delta);
            }
        };

        wsRef.current.onclose = () => {
            console.log("WebSocket closed");
        };

        return () => {
            // Cleanup
            if (wsRef.current) {
                wsRef.current.close();
            }
        };
    }, []);

    const handleToggleCall = async () => {
        if (!isCalling) {
            setIsCalling(true);
            await axios.post("http://localhost:3001/start-call");
            console.log("Call started");
        } else {
            setIsCalling(false);
            await axios.post("http://localhost:3001/stop-call");
            console.log("Call stopped");
        }
    };

    return (
        <div className="app-container">
            <header>
                <h1>Realtime AI Assistant</h1>
            </header>
            <main>
                <div className="info-section">
                    <p>
                        {isCalling
                            ? "Recording from server mic... Speak for ~1s, then press Stop."
                            : "Press 'Start' to begin a real-time audio conversation."}
                    </p>
                    <button
                        className={isCalling ? "btn stop-btn" : "btn start-btn"}
                        onClick={handleToggleCall}
                    >
                        {isCalling ? "Stop Call" : "Start Call"}
                    </button>
                </div>
            </main>
        </div>
    );
}

export default App;
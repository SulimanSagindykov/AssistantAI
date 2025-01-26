import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import "./App.css";

function App() {
    const [isCalling, setIsCalling] = useState(false);
    const wsRef = useRef(null);

    // Cleanup WebSocket on component unmount
    useEffect(() => {
        return () => {
            if (wsRef.current) {
                wsRef.current.close();
                console.log("WebSocket closed on component unmount");
            }
        };
    }, []);

    const handleToggleCall = async () => {
        if (!isCalling) {
            try {
                setIsCalling(true);
                await axios.post("http://localhost:3002/start-call");
                console.log("Call started");

                // Initialize WebSocket connection
                wsRef.current = new WebSocket("ws://localhost:3002");

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

                wsRef.current.onerror = (error) => {
                    console.error("WebSocket error:", error);
                };
            } catch (error) {
                console.error("Error starting call:", error);
                setIsCalling(false); // Revert state if there's an error
            }
        } else {
            try {
                setIsCalling(false);
                await axios.post("http://localhost:3002/stop-call");
                console.log("Call stopped");

                // Close WebSocket connection if it exists
                if (wsRef.current) {
                    wsRef.current.close();
                    wsRef.current = null;
                }
            } catch (error) {
                console.error("Error stopping call:", error);
            }
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
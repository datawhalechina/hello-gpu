import React from 'react';
import { createRoot } from 'react-dom/client';
import './fonts.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import App from './App.jsx';
import './style.css';
import './integration.css';
createRoot(document.getElementById('root')).render(<App/>);

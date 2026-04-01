import React, { useState } from 'react';
import { supabase } from './supabase'; // Ensure supabase.js is also in the src folder

const PortfolioSync = ({ onSyncComplete }) => {
  const [file, setFile] = useState(null);
  const [pan, setPan] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const handleUpload = async () => {
    if (!file || !pan) {
      setMessage("Please provide both the CAS PDF and your PAN.");
      return;
    }

    setLoading(true);
    setMessage("Analyzing your portfolio...");

    try {
      // 1. Get the current user from Supabase
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Please log in to sync your portfolio.");

      // 2. Prepare the data for your Python Backend
      const formData = new FormData();
      formData.append('file', file);
      formData.append('pan', pan.toUpperCase());
      formData.append('user_id', user.id);

      // 3. Call your Render Python Service 
      // REPLACE THE URL BELOW with your actual Render Web Service URL once it's live
      const response = await fetch('https://your-parser-service-name.onrender.com/api/parse', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (response.ok) {
        setMessage(`Success! Synced ${result.count} mutual fund holdings.`);
        if (onSyncComplete) onSyncComplete();
      } else {
        throw new Error(result.detail || "Failed to parse PDF.");
      }
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ 
      background: 'rgba(255, 255, 255, 0.05)', 
      padding: '15px', 
      borderRadius: '8px',
      border: '1px solid rgba(201, 168, 76, 0.2)' 
    }}>
      <div style={{ marginBottom: '10px' }}>
        <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '5px', color: '#c9a84c' }}>
          CAS PDF File
        </label>
        <input 
          type="file" 
          accept=".pdf" 
          onChange={(e) => setFile(e.target.files[0])}
          style={{ fontSize: '0.8rem', color: '#fff' }}
        />
      </div>

      <div style={{ marginBottom: '15px' }}>
        <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '5px', color: '#c9a84c' }}>
          PAN Number (for PDF password)
        </label>
        <input 
          type="text" 
          placeholder="ABCDE1234F"
          value={pan}
          onChange={(e) => setPan(e.target.value)}
          style={{ 
            width: '100%', 
            padding: '8px', 
            background: '#1a1a1a', 
            border: '1px solid #333', 
            color: '#fff',
            borderRadius: '4px'
          }}
        />
      </div>

      <button 
        onClick={handleUpload}
        disabled={loading}
        className="btn-primary" 
        style={{ 
          width: '100%', 
          padding: '10px', 
          cursor: loading ? 'not-allowed' : 'pointer',
          background: '#c9a84c',
          color: '#000',
          fontWeight: 'bold',
          border: 'none',
          borderRadius: '4px'
        }}
      >
        {loading ? "Processing..." : "Sync Mutual Funds"}
      </button>

      {message && (
        <p style={{ 
          marginTop: '10px', 
          fontSize: '0.75rem', 
          color: message.includes('Error') ? '#ff6b6b' : '#81b29a',
          textAlign: 'center' 
        }}>
          {message}
        </p>
      )}
    </div>
  );
};

export default PortfolioSync;
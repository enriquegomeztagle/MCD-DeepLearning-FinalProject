import { useState } from 'react'

// Auto-resolve: use VITE_API_URL if set at build, otherwise assume backend is on same origin
const API_URL = import.meta.env.VITE_API_URL || window.location.origin

function App() {
  const [result, setResult] = useState<string>('')

  const handlePredict = async () => {
    const res = await fetch(`${API_URL}/v1/predictions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': 'changeme' },
      body: JSON.stringify({ instances: [{ input: 'test data' }] }),
    })
    const data = await res.json()
    setResult(JSON.stringify(data, null, 2))
  }

  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>MCD Deep Learning</h1>
      <button onClick={handlePredict}>Run Prediction</button>
      {result && <pre style={{ marginTop: '1rem' }}>{result}</pre>}
    </div>
  )
}

export default App

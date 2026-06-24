const https = require('https');
require('dotenv').config();

const options = {
  hostname: 'generativelanguage.googleapis.com',
  path: `/v1beta/models?key=${process.env.GEMINI_API_KEY}`,
  method: 'GET'
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    const json = JSON.parse(data);
    if (json.models) {
        console.log("Available models:");
        json.models.forEach(m => console.log(m.name));
    } else {
        console.log("Error response:", json);
    }
  });
});

req.on('error', (e) => {
  console.error(e);
});
req.end();

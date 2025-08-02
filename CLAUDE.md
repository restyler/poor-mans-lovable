this is a test project to test cerebras:


curl --location 'https://api.cerebras.ai/v1/chat/completions' \
--header 'Content-Type: application/json' \
--header "Authorization: Bearer ${CEREBRAS_API_KEY}" \
--data '{
  "model": "qwen-3-coder-480b",
  "stream": true,
  "max_tokens": 40000,
  "temperature": 0.7,
  "top_p": 0.8,
  "messages": [
    {
      "role": "system",
      "content": ""
    }
  ]
}'
const { SarvamAIClient } = require("sarvamai");

const apiKey = process.env.SARVAM_API_KEY;
if (!apiKey) {
  console.error("SARVAM_API_KEY is not set. Paste your key into .env and run with: node --env-file=.env chat.js");
  process.exit(1);
}

const client = new SarvamAIClient({ apiSubscriptionKey: apiKey });

async function main() {
  const response = await client.chat.completions({
    model: "sarvam-105b-conversations",
    messages: [{ role: "user", content: "Say hello in one short sentence." }],
  });

  console.log(response.choices[0].message.content);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});

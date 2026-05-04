import express from "express";
import OpenAI from "openai";
import cors from "cors";
const app = express();
app.use(express.json());
app.use(cors());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.post("/api/swarm", async (req, res) => {
  try {
    const { prompt } = req.body;

    const response = await openai.responses.create({
      model: "gpt-4o-mini",
      input: prompt,
    });

    res.json({
      reply: response.output_text,
    });

  } catch (err) {
    console.error("FULL ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});


app.listen(4000, () => {
console.log("Server running on http://localhost:4000");
});
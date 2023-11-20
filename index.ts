// import { fileURLToPath } from "url";
// import path from "path";
import net from "net";
import OpenAI from "openai";
import endent from "endent";

const openai = new OpenAI({
  apiKey: "", // defaults to process.env["OPENAI_API_KEY"]
  baseURL: "https://oai.hconeai.com/v1",
  defaultHeaders: {
    // Add your Helicone API Key
    "Helicone-Auth": `Bearer `,
    "Helicone-Retry-Enabled": "true",
    "Helicone-Cache-Enabled": "true",
    "Helicone-Property-App": "emergencyHack",
  },
});

import { spawn } from "child_process";

let isPlaying = false;

const audioQueue: Buffer[] = [];

const playAudio = () => {
  if (isPlaying || audioQueue.length === 0) {
    return;
  }

  isPlaying = true;

  const mpv = spawn("mpv", ["--no-cache", "--no-terminal", "--", "fd://0"]);

  while (audioQueue.length > 0) {
    const buffer = audioQueue.shift(); // Remove all but the last audio chunk from the queue
    mpv.stdin.write(buffer);
  }

  mpv.stdin.end();

  mpv.stdout.on("data", (data: Buffer) => {
    console.log(`stdout: ${data}`);
  });

  mpv.stderr.on("data", (data: Buffer) => {
    console.error(`stderr: ${data}`);
  });

  mpv.on("close", async (code: number) => {
    console.log(`mpv process exited with code ${code}`);
    isPlaying = false; // Release the lock when the audio finishes playing

    playAudio(); // Try to play the next audio chunk
  });
};

let isNewThought = true;

const enqueueAudio = (audioBuffer: Buffer) => {
  if (isNewThought) {
    audioQueue.length = 0; // Clear the queue
    isNewThought = false;
  }

  audioQueue.push(audioBuffer);
  playAudio(); // Try to play the audio immediately
};

// Call this function when a new thought begins
const startNewThought = () => {
  isNewThought = true;
};

// const __dirname = path.dirname(fileURLToPath(import.meta.url));

let currentChunk = "";
let prevChunk = "";

// const audioContext = new AudioContext();

const wsUrl = `wss://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM/stream-input?model_id=eleven_turbo_v2`;
const socket = new WebSocket(wsUrl);

socket.onopen = function (event) {
  const bosMessage = {
    text: " ",
    voice_settings: {
      stability: 0.5,
      similarity_boost: true,
    },
    xi_api_key: "", // replace with your API key
  };

  socket.send(JSON.stringify(bosMessage));

  setInterval(() => {
    const keepAliveMessage = {
      text: " ", // replace with your blank token
    };

    socket.send(JSON.stringify(keepAliveMessage));
  }, 15000);
};

socket.onmessage = async function (event) {
  const response = JSON.parse(event.data as string);

  // console.log("Server response:", response);

  if (response.audio) {
    // decode and handle the audio data (e.g., play it)
    console.log("Received audio chunk");

    const audioChunk = atob(response.audio); // decode base64
    const audioBuffer = Buffer.from(audioChunk, "binary");

    enqueueAudio(audioBuffer);
  } else {
    console.log("No audio data in the response");
  }

  if (response.isFinal) {
    // the generation is complete
  }

  if (response.normalizedAlignment) {
    // use the alignment info if needed
  }
};

// Handle errors
socket.onerror = function (error) {
  console.error(`WebSocket Error: ${error}`);
};

// Handle socket closing
socket.onclose = function (event) {
  if (event.wasClean) {
    console.info(
      `Connection closed cleanly, code=${event.code}, reason=${event.reason}`
    );
  } else {
    console.warn("Connection died");
  }
};

// const model = new LlamaModel({
//   modelPath:
//     "/Users/cryogenic/general/llama.cpp/models/mistral-7b-instruct-v0.1.Q8_0.gguf",
// });

// const context = new LlamaContext({ model });
// const session = new LlamaChatSession({
//   context,
// });

const whisperServerStart = () => {
  const server = net.createServer((socket: net.Socket) => {
    socket.on("data", (data: Buffer) => {
      handleConnection(data, socket);
    });
  });
  server.listen(43001, "localhost");
};

const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

const handleGptGeneration = async (currentChunk: string) => {
  const resp = await openai.chat.completions.create({
    model: "gpt-4-1106-preview",
    messages: [
      {
        role: "system",
        content: endent`  
        You have two different decisions to make, with two agents
      
        First, you will act as an agent that determines if a user has finished a thought, changed thoughts or should be interrupted
        You are given the following:
        - The current chunk of what the user spoke
      
        You already have the following:
        - past context
        - whatever you said so far
      
        You are to choose one of the following:
        <0> which stands for the user has not finished their thought, wait for more input (this should be your default responsive)
        <1> which stands for the user has finished their thought, generate a response
        <2> which stands for the user has changed their thought, generate a response
        <3> which stands for there is enough context to generate a response, generate a response and interrupt the user currently speaking
      
        if the first agent returns 0, you will return "~cont~" which means continue the conversation
      
        else you will act as an agent that generates a response to the user
        You are a conversational assistant that helps users, remember that the text you generate will be converted to speech so make sure the text generated is
        - concise
        - conversational and fluid
        - has intonation, emotes, pauses, filler words, the ums and ahs and the following along
      
        DO NOT reply anything that you are not comfortable with being said out loud
      
       The final return will look like this:
       <reason>Your reasoning</reason>
       <{0|1|2|3}><0> ? "~cont~" : <your reply to the user that will be spoken out loud here by another agent>`,
      },
      ...messages,
      {
        role: "user",
        content: `${currentChunk}`,
      },
    ],
    stream: true,
  });

  let msg = "";
  let reply = false;
  let currentlyStreaming = false;

  let prevMsg = "";
  const wordBuffer: string[] = [];

  for await (const chunk of resp) {
    msg += chunk.choices[0].delta.content;

    const numberRegex = new RegExp("<[0-3]>", "g");
    const zeroRegex = new RegExp("<0>", "g");

    msg = msg.replace(/<reason>.*?<\/reason>/g, "");
    // Replace any undefined values in the message
    msg = msg.replace(/undefined/g, "");

    if (numberRegex.test(msg)) {
      if (zeroRegex.test(msg)) {
        // Your code here
        reply = false;
      } else {
        const numberCodeMatch = msg.match(numberRegex);
        const numberCode = numberCodeMatch
          ? parseInt(numberCodeMatch[0].replace(/[<>]/g, ""))
          : null;

        if (numberCode) {
          if (numberCode === 2 || numberCode === 3) {
            startNewThought();
          }
        }
        // Your code here
        reply = true;
      }
    }

    msg = msg.replace(/<\d>/g, "").replace(/<\d>/g, "");

    const diff = msg.replace(prevMsg, "");

    // if (reply) {
    //   if (wordBuffer.length > 3) {
    //     if (currentlyStreaming) {
    //       let txt = wordBuffer.join(" ");

    //       txt = txt.replace(/~cont~/g, "");
    //       txt = txt.replace(/<\d>/g, "");
    //       txt = txt.replace(/undefined/g, "");

    //       const textMessage = {
    //         text: txt,
    //         try_trigger_generation: true,
    //       };

    //       socket.send(JSON.stringify(textMessage));

    //       prevMsg += txt;
    //     } else {
    //       currentlyStreaming = true;

    //       const textMessage = {
    //         text: msg,
    //         try_trigger_generation: true,
    //       };

    //       socket.send(JSON.stringify(textMessage));
    //       prevMsg = msg;
    //     }
    //   } else {
    //     const newWords = diff.split(" ");
    //     newWords.forEach((word) => {
    //       if (word !== "") {
    //         wordBuffer.push(word.trim());
    //       }
    //     });
    //   }
    // }
  }

  if (reply) {
    let txt = msg;

    txt = txt.replace(/~cont~/g, "");
    txt = txt.replace(/<\d>/g, "");
    txt = txt.replace(/undefined/g, "");

    console.log("Sending message:", txt);

    const textMessage = {
      text: txt,
      try_trigger_generation: true,
    };

    socket.send(JSON.stringify(textMessage));
  }

  messages.push({
    role: "user",
    content: `${currentChunk}`,
  });

  messages.push({
    role: "system",
    content: `${msg}`,
  });
};

// const handleChunk = async (currentChunk: string, prevChunk: string) => {
//   const resp = await session.prompt(`

//     You are an agent that determines if a user has finished a thought, changed thoughts or should be interrupted
//     You are given the following:
//     - The current chunk of what the user spoke
//     - The previous chunk of what the user spoke

//     You are expected to return one of the following:
//     0 which stands for the user has not finished their thought, wait for more input (this should be your default responsive)
//     1 which stands for the user has finished their thought, generate a response
//     2 which stands for the user has changed their thought, generate a response
//     3 which stands for there is enough context to generate a response, generate a response and interrupt the user currently speaking

//     Return only a number between 0 and 4

//     Current Chunk: ${currentChunk}
//     Previous Chunk: ${prevChunk}`);

//   // Manually garbage collect the session

//   return resp;
// };

const handleConnection = async (data: Buffer, socket: net.Socket) => {
  const message = data.toString();
  //   console.log(`Message Received: ${message}`);

  currentChunk += message.replace("[Start speaking]", ""); // Always update currentChunk with the new message

  if (message.includes("[_BEG_]")) {
    if (currentChunk !== "") {
      console.log("handle msg because has _BEG_", currentChunk);
      //   chunkChannel <- chunk{current: currentChunk, prev: prevChunk}

      // const prom = handleChunk(currentChunk, prevChunk);
      const prom = handleGptGeneration(currentChunk);
      currentChunk = "";
    }
  }
};

whisperServerStart();

process.on("exit", (code) => {
  const eosMessage = {
    text: "",
  };

  socket.send(JSON.stringify(eosMessage));

  socket.close();
});

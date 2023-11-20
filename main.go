package main

import (
	"bufio"
	"bytes"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"runtime"
	"strings"

	llama "github.com/go-skynet/go-llama.cpp"
)

var (
	threads   = 4
	tokens    = 128
	gpulayers = 0
	seed      = -1
)

func main() {
	var model string

	flags := flag.NewFlagSet(os.Args[0], flag.ExitOnError)
	flags.StringVar(&model, "m", "/Users/cryogenic/general/llama.cpp/models/mistral-7b-v0.1.Q5_K_M.gguf", "path to q4_0.bin model file to load")
	flags.IntVar(&gpulayers, "ngl", 0, "Number of GPU layers to use")
	flags.IntVar(&threads, "t", runtime.NumCPU(), "number of threads to use during computation")
	flags.IntVar(&tokens, "n", 10, "number of tokens to predict")
	flags.IntVar(&seed, "s", -1, "predict RNG seed, -1 for random seed")

	err := flags.Parse(os.Args[1:])
	if err != nil {
		fmt.Printf("Parsing program arguments failed: %s", err)
		os.Exit(1)
	}
	l, err := llama.New(model, llama.EnableF16Memory, llama.SetContext(128), llama.EnableEmbeddings, llama.SetGPULayers(gpulayers))
	if err != nil {
		fmt.Println("Loading the model failed:", err.Error())
		os.Exit(1)
	}
	fmt.Printf("Model loaded successfully.\n")

	reader := bufio.NewReader(os.Stdin)

	for {
		text := readMultiLineInput(reader)

		_, err := l.Predict(text, llama.Debug, llama.SetTokenCallback(func(token string) bool {
			fmt.Print(token)
			return true
		}), llama.SetTokens(tokens), llama.SetThreads(threads), llama.SetTopK(90), llama.SetTopP(0.86), llama.SetStopWords("llama"), llama.SetSeed(seed))
		if err != nil {
			panic(err)
		}
		embeds, err := l.Embeddings(text)
		if err != nil {
			fmt.Printf("Embeddings: error %s \n", err.Error())
		}
		fmt.Printf("Embeddings: %v", embeds)
		fmt.Printf("\n\n")
	}
}

func whisper() {
	cmd := exec.Command("whisperStream", "-m", "/Users/cryogenic/general/llama.cpp/models/ggml-medium.en.bin", "-t", "32", "--step", "2500", "-ac", "768")
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		log.Fatal(err)
	}

	if err := cmd.Start(); err != nil {
		log.Fatal(err)
	}

	buf := new(bytes.Buffer)
	buf.ReadFrom(stdout)
	newStr := buf.String()

	fmt.Println(newStr)

	if err := cmd.Wait(); err != nil {
		log.Fatal(err)
	}
}

// readMultiLineInput reads input until an empty line is entered.
func readMultiLineInput(reader *bufio.Reader) string {
	var lines []string
	fmt.Print(">>> ")

	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			if err == io.EOF {
				os.Exit(0)
			}
			fmt.Printf("Reading the prompt failed: %s", err)
			os.Exit(1)
		}

		if len(strings.TrimSpace(line)) == 0 {
			break
		}

		lines = append(lines, line)
	}

	text := strings.Join(lines, "")
	fmt.Println("Sending", text)
	return text
}

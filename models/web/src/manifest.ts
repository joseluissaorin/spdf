// Generated from models/manifest.json by scripts/sync-manifest.mjs. Do not edit.
export default {
 "spdf_models": 1,
 "updated": "2026-10-07",
 "models": [
  {
   "id": "embeddinggemma-2-gguf-q8_0",
   "name": "EmbeddingGemma 2 · GGUF Q8_0 + mmproj Q8_0 (texto, imagen, audio)",
   "family": "embeddinggemma-2",
   "kind": "embed",
   "kinds": [
    "embed"
   ],
   "engine": "llama.cpp",
   "format": "gguf",
   "license": "Apache-2.0",
   "license_url": "https://www.apache.org/licenses/LICENSE-2.0",
   "source": "https://huggingface.co/ggml-org/embeddinggemma-2-GGUF",
   "revision": "bfcd298762cc34d0357ece5ebdd31791a3a374d8",
   "bytes": 864676480,
   "files": [
    {
     "role": "model",
     "path": "embeddinggemma-2-Q8_0.gguf",
     "url": "https://huggingface.co/ggml-org/embeddinggemma-2-GGUF/resolve/bfcd298762cc34d0357ece5ebdd31791a3a374d8/embeddinggemma-2-Q8_0.gguf",
     "bytes": 309855456,
     "sha256": "2188ac1deca4b77dffefd603c2776a9d76d9d74ec01841392982ebb840b09135"
    },
    {
     "role": "mmproj",
     "path": "mmproj-embeddinggemma-2-Q8_0.gguf",
     "url": "https://huggingface.co/ggml-org/embeddinggemma-2-GGUF/resolve/bfcd298762cc34d0357ece5ebdd31791a3a374d8/mmproj-embeddinggemma-2-Q8_0.gguf",
     "bytes": 554821024,
     "sha256": "c4a8a52691ecef40618438928bdf9e68379b854e24166f292592353db0aab64f"
    }
   ],
   "modalities": [
    "text",
    "image",
    "audio"
   ],
   "platforms": [
    "macos",
    "windows",
    "linux",
    "ios",
    "android"
   ],
   "min_memory_mb": 1400,
   "space_version": "914f7f89",
   "judge_calibration": null,
   "notes": null,
   "published": true
  },
  {
   "id": "embeddinggemma-2-gguf-q8_0-text",
   "name": "EmbeddingGemma 2 · GGUF Q8_0, solo texto",
   "family": "embeddinggemma-2",
   "kind": "embed",
   "kinds": [
    "embed"
   ],
   "engine": "llama.cpp",
   "format": "gguf",
   "license": "Apache-2.0",
   "license_url": "https://www.apache.org/licenses/LICENSE-2.0",
   "source": "https://huggingface.co/ggml-org/embeddinggemma-2-GGUF",
   "revision": "bfcd298762cc34d0357ece5ebdd31791a3a374d8",
   "bytes": 309855456,
   "files": [
    {
     "role": "model",
     "path": "embeddinggemma-2-Q8_0.gguf",
     "url": "https://huggingface.co/ggml-org/embeddinggemma-2-GGUF/resolve/bfcd298762cc34d0357ece5ebdd31791a3a374d8/embeddinggemma-2-Q8_0.gguf",
     "bytes": 309855456,
     "sha256": "2188ac1deca4b77dffefd603c2776a9d76d9d74ec01841392982ebb840b09135"
    }
   ],
   "modalities": [
    "text"
   ],
   "platforms": [
    "macos",
    "windows",
    "linux",
    "ios",
    "android"
   ],
   "min_memory_mb": 500,
   "space_version": "914f7f89",
   "judge_calibration": null,
   "notes": null,
   "published": true
  },
  {
   "id": "embeddinggemma-2-gguf-bf16",
   "name": "EmbeddingGemma 2 · GGUF BF16 + mmproj BF16",
   "family": "embeddinggemma-2",
   "kind": "embed",
   "kinds": [
    "embed"
   ],
   "engine": "llama.cpp",
   "format": "gguf",
   "license": "Apache-2.0",
   "license_url": "https://www.apache.org/licenses/LICENSE-2.0",
   "source": "https://huggingface.co/ggml-org/embeddinggemma-2-GGUF",
   "revision": "bfcd298762cc34d0357ece5ebdd31791a3a374d8",
   "bytes": 1540024960,
   "files": [
    {
     "role": "model",
     "path": "embeddinggemma-2-BF16.gguf",
     "url": "https://huggingface.co/ggml-org/embeddinggemma-2-GGUF/resolve/bfcd298762cc34d0357ece5ebdd31791a3a374d8/embeddinggemma-2-BF16.gguf",
     "bytes": 557950176,
     "sha256": "68bae29d62fb8c7d23e98d21fd4662753ddd636e6b62b8a70dfe059a9844f216"
    },
    {
     "role": "mmproj",
     "path": "mmproj-embeddinggemma-2-BF16.gguf",
     "url": "https://huggingface.co/ggml-org/embeddinggemma-2-GGUF/resolve/bfcd298762cc34d0357ece5ebdd31791a3a374d8/mmproj-embeddinggemma-2-BF16.gguf",
     "bytes": 982074784,
     "sha256": "d2033b3cd0223cfb2e7a2b50dc80a664c78c816d375f5b017ec3ef80ee0bc766"
    }
   ],
   "modalities": [
    "text",
    "image",
    "audio"
   ],
   "platforms": [
    "macos",
    "windows",
    "linux"
   ],
   "min_memory_mb": 2200,
   "space_version": "914f7f89",
   "judge_calibration": null,
   "notes": null,
   "published": true
  },
  {
   "id": "embeddinggemma-2-onnx-q8",
   "name": "EmbeddingGemma 2 · ONNX q8 (WASM y WebGPU)",
   "family": "embeddinggemma-2",
   "kind": "embed",
   "kinds": [
    "embed"
   ],
   "engine": "transformers.js",
   "format": "onnx",
   "license": "Apache-2.0",
   "license_url": "https://www.apache.org/licenses/LICENSE-2.0",
   "source": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX",
   "revision": "daa72c51243991dfcaf9f9137d2c573d8f7790c0",
   "bytes": 882100267,
   "files": [
    {
     "role": "config.json",
     "path": "config.json",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/config.json",
     "bytes": 5031,
     "sha256": "8d011bfe08b5e345bbe0b81e5c6fd02c381920b345b986047bc2a33ce7b90d1d"
    },
    {
     "role": "config_sentence_transformers.json",
     "path": "config_sentence_transformers.json",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/config_sentence_transformers.json",
     "bytes": 1565,
     "sha256": "031e56a498d33c349ab489a21885bcfe25b4fcba841149dc99e1e90d4a7c28f5"
    },
    {
     "role": "preprocessor_config.json",
     "path": "preprocessor_config.json",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/preprocessor_config.json",
     "bytes": 560,
     "sha256": "9344893f8d0573a46ebb2ca54c03f56d044cea194c8dcfb1f4d652240ac21daa"
    },
    {
     "role": "processor_config.json",
     "path": "processor_config.json",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/processor_config.json",
     "bytes": 1788,
     "sha256": "168f6a08522f3ce5dea596d94d003af2fd691742d4f41fe1f9d8cce76bfbf69c"
    },
    {
     "role": "tokenizer.json",
     "path": "tokenizer.json",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/tokenizer.json",
     "bytes": 32170510,
     "sha256": "4d777ef5bdc1aa36227abdfb77c3e49e7b9c892d16e1b6bda41c393504828be4"
    },
    {
     "role": "tokenizer_config.json",
     "path": "tokenizer_config.json",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/tokenizer_config.json",
     "bytes": 1599,
     "sha256": "17bd5d6e9364ca49a534e1502076593317c298d4a663623091ed45388f004874"
    },
    {
     "role": "onnx",
     "path": "onnx/model_quantized.onnx",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/onnx/model_quantized.onnx",
     "bytes": 495165,
     "sha256": "d06edd601f851c633a2519304cbeb8dc6170d7ceb61b436625c17fb9b6e74953"
    },
    {
     "role": "onnx_data",
     "path": "onnx/model_quantized.onnx_data",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/onnx/model_quantized.onnx_data",
     "bytes": 313724928,
     "sha256": "278a7ff1248c3618e4bd11a607fc54f7bdc7778854230f3956d3f86bd9db4f3b"
    },
    {
     "role": "onnx",
     "path": "onnx/vision_encoder_quantized.onnx",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/onnx/vision_encoder_quantized.onnx",
     "bytes": 162495,
     "sha256": "bb0de2df53a2448a32dc7908a187c168c8afd514d4d6f674f7f46024875fa4e3"
    },
    {
     "role": "onnx_data",
     "path": "onnx/vision_encoder_quantized.onnx_data",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/onnx/vision_encoder_quantized.onnx_data",
     "bytes": 195228672,
     "sha256": "3dabd69c0a36e9a8771ad82030dde74daa5a0e02b7047a5d3f3382b1137bab89"
    },
    {
     "role": "onnx",
     "path": "onnx/audio_encoder_quantized.onnx",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/onnx/audio_encoder_quantized.onnx",
     "bytes": 249330,
     "sha256": "04a9a9094ba76fb169e4c69be45a4b621580188654d6be59eab860eadcd42d3c"
    },
    {
     "role": "onnx_data",
     "path": "onnx/audio_encoder_quantized.onnx_data",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/onnx/audio_encoder_quantized.onnx_data",
     "bytes": 340058624,
     "sha256": "aa6361d898e1f1d6303f8dd2b5fabf4fd3629e15fd709e9cb06ac5cb9416a030"
    }
   ],
   "modalities": [
    "text",
    "image",
    "audio"
   ],
   "platforms": [
    "web"
   ],
   "min_memory_mb": 1500,
   "space_version": "914f7f89",
   "judge_calibration": null,
   "notes": null,
   "dtype": "q8",
   "published": true
  },
  {
   "id": "embeddinggemma-2-onnx-q8-text",
   "name": "EmbeddingGemma 2 · ONNX q8, solo texto",
   "family": "embeddinggemma-2",
   "kind": "embed",
   "kinds": [
    "embed"
   ],
   "engine": "transformers.js",
   "format": "onnx",
   "license": "Apache-2.0",
   "license_url": "https://www.apache.org/licenses/LICENSE-2.0",
   "source": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX",
   "revision": "daa72c51243991dfcaf9f9137d2c573d8f7790c0",
   "bytes": 346401146,
   "files": [
    {
     "role": "config.json",
     "path": "config.json",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/config.json",
     "bytes": 5031,
     "sha256": "8d011bfe08b5e345bbe0b81e5c6fd02c381920b345b986047bc2a33ce7b90d1d"
    },
    {
     "role": "config_sentence_transformers.json",
     "path": "config_sentence_transformers.json",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/config_sentence_transformers.json",
     "bytes": 1565,
     "sha256": "031e56a498d33c349ab489a21885bcfe25b4fcba841149dc99e1e90d4a7c28f5"
    },
    {
     "role": "preprocessor_config.json",
     "path": "preprocessor_config.json",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/preprocessor_config.json",
     "bytes": 560,
     "sha256": "9344893f8d0573a46ebb2ca54c03f56d044cea194c8dcfb1f4d652240ac21daa"
    },
    {
     "role": "processor_config.json",
     "path": "processor_config.json",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/processor_config.json",
     "bytes": 1788,
     "sha256": "168f6a08522f3ce5dea596d94d003af2fd691742d4f41fe1f9d8cce76bfbf69c"
    },
    {
     "role": "tokenizer.json",
     "path": "tokenizer.json",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/tokenizer.json",
     "bytes": 32170510,
     "sha256": "4d777ef5bdc1aa36227abdfb77c3e49e7b9c892d16e1b6bda41c393504828be4"
    },
    {
     "role": "tokenizer_config.json",
     "path": "tokenizer_config.json",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/tokenizer_config.json",
     "bytes": 1599,
     "sha256": "17bd5d6e9364ca49a534e1502076593317c298d4a663623091ed45388f004874"
    },
    {
     "role": "onnx",
     "path": "onnx/model_quantized.onnx",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/onnx/model_quantized.onnx",
     "bytes": 495165,
     "sha256": "d06edd601f851c633a2519304cbeb8dc6170d7ceb61b436625c17fb9b6e74953"
    },
    {
     "role": "onnx_data",
     "path": "onnx/model_quantized.onnx_data",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/onnx/model_quantized.onnx_data",
     "bytes": 313724928,
     "sha256": "278a7ff1248c3618e4bd11a607fc54f7bdc7778854230f3956d3f86bd9db4f3b"
    }
   ],
   "modalities": [
    "text"
   ],
   "platforms": [
    "web"
   ],
   "min_memory_mb": 700,
   "space_version": "914f7f89",
   "judge_calibration": null,
   "notes": null,
   "dtype": "q8",
   "published": true
  },
  {
   "id": "embeddinggemma-2-onnx-fp16",
   "name": "EmbeddingGemma 2 · ONNX fp16 (WebGPU)",
   "family": "embeddinggemma-2",
   "kind": "embed",
   "kinds": [
    "embed"
   ],
   "engine": "transformers.js",
   "format": "onnx",
   "license": "Apache-2.0",
   "license_url": "https://www.apache.org/licenses/LICENSE-2.0",
   "source": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX",
   "revision": "daa72c51243991dfcaf9f9137d2c573d8f7790c0",
   "bytes": 1497223587,
   "files": [
    {
     "role": "config.json",
     "path": "config.json",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/config.json",
     "bytes": 5031,
     "sha256": "8d011bfe08b5e345bbe0b81e5c6fd02c381920b345b986047bc2a33ce7b90d1d"
    },
    {
     "role": "config_sentence_transformers.json",
     "path": "config_sentence_transformers.json",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/config_sentence_transformers.json",
     "bytes": 1565,
     "sha256": "031e56a498d33c349ab489a21885bcfe25b4fcba841149dc99e1e90d4a7c28f5"
    },
    {
     "role": "preprocessor_config.json",
     "path": "preprocessor_config.json",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/preprocessor_config.json",
     "bytes": 560,
     "sha256": "9344893f8d0573a46ebb2ca54c03f56d044cea194c8dcfb1f4d652240ac21daa"
    },
    {
     "role": "processor_config.json",
     "path": "processor_config.json",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/processor_config.json",
     "bytes": 1788,
     "sha256": "168f6a08522f3ce5dea596d94d003af2fd691742d4f41fe1f9d8cce76bfbf69c"
    },
    {
     "role": "tokenizer.json",
     "path": "tokenizer.json",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/tokenizer.json",
     "bytes": 32170510,
     "sha256": "4d777ef5bdc1aa36227abdfb77c3e49e7b9c892d16e1b6bda41c393504828be4"
    },
    {
     "role": "tokenizer_config.json",
     "path": "tokenizer_config.json",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/tokenizer_config.json",
     "bytes": 1599,
     "sha256": "17bd5d6e9364ca49a534e1502076593317c298d4a663623091ed45388f004874"
    },
    {
     "role": "onnx",
     "path": "onnx/model_fp16.onnx",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/onnx/model_fp16.onnx",
     "bytes": 425780,
     "sha256": "a49e227d7e0e5f4ee606d79879d084264366367bc6318f344ab179e35d4fd6a4"
    },
    {
     "role": "onnx_data",
     "path": "onnx/model_fp16.onnx_data",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/onnx/model_fp16.onnx_data",
     "bytes": 542085120,
     "sha256": "b9dbe09415d77c8686ba6e216a244086f4ada1608238c13f2bfaa587ba627207"
    },
    {
     "role": "onnx",
     "path": "onnx/vision_encoder_fp16.onnx",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/onnx/vision_encoder_fp16.onnx",
     "bytes": 112253,
     "sha256": "3e2b6d5648a3ae61b572cc3ec0a23b13ebfda3b63e3c9c343c593636392a879c"
    },
    {
     "role": "onnx_data",
     "path": "onnx/vision_encoder_fp16.onnx_data",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/onnx/vision_encoder_fp16.onnx_data",
     "bytes": 335513088,
     "sha256": "9f374070808b8b96252f7d04c9c4eae34df60283473fde5a3fbf4d9205495e19"
    },
    {
     "role": "onnx",
     "path": "onnx/audio_encoder_fp16.onnx",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/onnx/audio_encoder_fp16.onnx",
     "bytes": 211381,
     "sha256": "06237e04855d57053c3880f70f2575016dec1b1ce22f262fa76c6bd010616799"
    },
    {
     "role": "onnx_data",
     "path": "onnx/audio_encoder_fp16.onnx_data",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/onnx/audio_encoder_fp16.onnx_data",
     "bytes": 586694912,
     "sha256": "3a9417444f3cb7bb868525b66859cc1d4b7a00128ea0b111f7aee2843739cd3b"
    }
   ],
   "modalities": [
    "text",
    "image",
    "audio"
   ],
   "platforms": [
    "web"
   ],
   "min_memory_mb": 2500,
   "space_version": "914f7f89",
   "judge_calibration": null,
   "notes": null,
   "dtype": "fp16",
   "published": true
  },
  {
   "id": "embeddinggemma-2-onnx-q4",
   "name": "EmbeddingGemma 2 · ONNX q4 (WebGPU)",
   "family": "embeddinggemma-2",
   "kind": "embed",
   "kinds": [
    "embed"
   ],
   "engine": "transformers.js",
   "format": "onnx",
   "license": "Apache-2.0",
   "license_url": "https://www.apache.org/licenses/LICENSE-2.0",
   "source": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX",
   "revision": "daa72c51243991dfcaf9f9137d2c573d8f7790c0",
   "bytes": 505139202,
   "files": [
    {
     "role": "config.json",
     "path": "config.json",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/config.json",
     "bytes": 5031,
     "sha256": "8d011bfe08b5e345bbe0b81e5c6fd02c381920b345b986047bc2a33ce7b90d1d"
    },
    {
     "role": "config_sentence_transformers.json",
     "path": "config_sentence_transformers.json",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/config_sentence_transformers.json",
     "bytes": 1565,
     "sha256": "031e56a498d33c349ab489a21885bcfe25b4fcba841149dc99e1e90d4a7c28f5"
    },
    {
     "role": "preprocessor_config.json",
     "path": "preprocessor_config.json",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/preprocessor_config.json",
     "bytes": 560,
     "sha256": "9344893f8d0573a46ebb2ca54c03f56d044cea194c8dcfb1f4d652240ac21daa"
    },
    {
     "role": "processor_config.json",
     "path": "processor_config.json",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/processor_config.json",
     "bytes": 1788,
     "sha256": "168f6a08522f3ce5dea596d94d003af2fd691742d4f41fe1f9d8cce76bfbf69c"
    },
    {
     "role": "tokenizer.json",
     "path": "tokenizer.json",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/tokenizer.json",
     "bytes": 32170510,
     "sha256": "4d777ef5bdc1aa36227abdfb77c3e49e7b9c892d16e1b6bda41c393504828be4"
    },
    {
     "role": "tokenizer_config.json",
     "path": "tokenizer_config.json",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/tokenizer_config.json",
     "bytes": 1599,
     "sha256": "17bd5d6e9364ca49a534e1502076593317c298d4a663623091ed45388f004874"
    },
    {
     "role": "onnx",
     "path": "onnx/model_q4.onnx",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/onnx/model_q4.onnx",
     "bytes": 490742,
     "sha256": "f9eeba97acddf139b8ee2ddf04bc30dceafa88de93fadf74d7644e0d61a477a9"
    },
    {
     "role": "onnx_data",
     "path": "onnx/model_q4.onnx_data",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/onnx/model_q4.onnx_data",
     "bytes": 174028800,
     "sha256": "c3975f2d1ab7a1878ae31a7d7a9b7804a827aff3800b60dfceafce21cac3df49"
    },
    {
     "role": "onnx",
     "path": "onnx/vision_encoder_q4.onnx",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/onnx/vision_encoder_q4.onnx",
     "bytes": 159400,
     "sha256": "7ea284226d4938f0ad921ab091f1d80a9ca699aa802984ef5cd5eec4f4761d96"
    },
    {
     "role": "onnx_data",
     "path": "onnx/vision_encoder_q4.onnx_data",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/onnx/vision_encoder_q4.onnx_data",
     "bytes": 108957696,
     "sha256": "0a9d6c927334f152a33dd90874f65d6ea5228999abe6a450d3f7813677fa704c"
    },
    {
     "role": "onnx",
     "path": "onnx/audio_encoder_q4.onnx",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/onnx/audio_encoder_q4.onnx",
     "bytes": 245543,
     "sha256": "c4cce3370e72262280d00293cac038896050a03a8e9a27e10b061ca97510296e"
    },
    {
     "role": "onnx_data",
     "path": "onnx/audio_encoder_q4.onnx_data",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/onnx/audio_encoder_q4.onnx_data",
     "bytes": 189075968,
     "sha256": "ba9328e6341360974083085b44b2bba265003bda564740f7c4c23ed9928f17e2"
    }
   ],
   "modalities": [
    "text",
    "image",
    "audio"
   ],
   "platforms": [
    "web"
   ],
   "min_memory_mb": 1200,
   "space_version": "914f7f89+q4",
   "judge_calibration": null,
   "notes": null,
   "dtype": "q4",
   "published": true
  },
  {
   "id": "embeddinggemma-2-onnx-q4f16",
   "name": "EmbeddingGemma 2 · ONNX q4f16 (WebGPU)",
   "family": "embeddinggemma-2",
   "kind": "embed",
   "kinds": [
    "embed"
   ],
   "engine": "transformers.js",
   "format": "onnx",
   "license": "Apache-2.0",
   "license_url": "https://www.apache.org/licenses/LICENSE-2.0",
   "source": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX",
   "revision": "daa72c51243991dfcaf9f9137d2c573d8f7790c0",
   "bytes": 457905182,
   "files": [
    {
     "role": "config.json",
     "path": "config.json",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/config.json",
     "bytes": 5031,
     "sha256": "8d011bfe08b5e345bbe0b81e5c6fd02c381920b345b986047bc2a33ce7b90d1d"
    },
    {
     "role": "config_sentence_transformers.json",
     "path": "config_sentence_transformers.json",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/config_sentence_transformers.json",
     "bytes": 1565,
     "sha256": "031e56a498d33c349ab489a21885bcfe25b4fcba841149dc99e1e90d4a7c28f5"
    },
    {
     "role": "preprocessor_config.json",
     "path": "preprocessor_config.json",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/preprocessor_config.json",
     "bytes": 560,
     "sha256": "9344893f8d0573a46ebb2ca54c03f56d044cea194c8dcfb1f4d652240ac21daa"
    },
    {
     "role": "processor_config.json",
     "path": "processor_config.json",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/processor_config.json",
     "bytes": 1788,
     "sha256": "168f6a08522f3ce5dea596d94d003af2fd691742d4f41fe1f9d8cce76bfbf69c"
    },
    {
     "role": "tokenizer.json",
     "path": "tokenizer.json",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/tokenizer.json",
     "bytes": 32170510,
     "sha256": "4d777ef5bdc1aa36227abdfb77c3e49e7b9c892d16e1b6bda41c393504828be4"
    },
    {
     "role": "tokenizer_config.json",
     "path": "tokenizer_config.json",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/tokenizer_config.json",
     "bytes": 1599,
     "sha256": "17bd5d6e9364ca49a534e1502076593317c298d4a663623091ed45388f004874"
    },
    {
     "role": "onnx",
     "path": "onnx/model_q4f16.onnx",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/onnx/model_q4f16.onnx",
     "bytes": 495298,
     "sha256": "53feeced79582d661e30adeaa9829cea90d92b1c78347e26fd123773580f71d0"
    },
    {
     "role": "onnx_data",
     "path": "onnx/model_q4f16.onnx_data",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/onnx/model_q4f16.onnx_data",
     "bytes": 156862464,
     "sha256": "c39fbaa1fb4221f04beb82786a06b81999c514fd39e84fcd58ef79413c87fa56"
    },
    {
     "role": "onnx",
     "path": "onnx/vision_encoder_q4f16.onnx",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/onnx/vision_encoder_q4f16.onnx",
     "bytes": 150693,
     "sha256": "55975fba53928162eee37e9eea2a69965c10c0411ed14c24ea149efa55a8aa68"
    },
    {
     "role": "onnx_data",
     "path": "onnx/vision_encoder_q4f16.onnx_data",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/onnx/vision_encoder_q4f16.onnx_data",
     "bytes": 97614336,
     "sha256": "842f996aff092e300c966266ae0cc60771c6ca16282fee04ca83f0f159bc6b33"
    },
    {
     "role": "onnx",
     "path": "onnx/audio_encoder_q4f16.onnx",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/onnx/audio_encoder_q4f16.onnx",
     "bytes": 252538,
     "sha256": "e61ee0d27a4ee2b13cfa4f6492d6bc9e18d23f998992b31e9c7355be6c028d58"
    },
    {
     "role": "onnx_data",
     "path": "onnx/audio_encoder_q4f16.onnx_data",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/onnx/audio_encoder_q4f16.onnx_data",
     "bytes": 170348800,
     "sha256": "356991f24ed4daee4728997a71fe11b72ebf5c053410ac29c7ce27d0f3fc7655"
    }
   ],
   "modalities": [
    "text",
    "image",
    "audio"
   ],
   "platforms": [
    "web"
   ],
   "min_memory_mb": 1100,
   "space_version": "914f7f89+q4",
   "judge_calibration": null,
   "notes": null,
   "dtype": "q4f16",
   "published": true
  },
  {
   "id": "embeddinggemma-2-onnx-q4f16-text",
   "name": "EmbeddingGemma 2 · ONNX q4f16, solo texto (el más pequeño)",
   "family": "embeddinggemma-2",
   "kind": "embed",
   "kinds": [
    "embed"
   ],
   "engine": "transformers.js",
   "format": "onnx",
   "license": "Apache-2.0",
   "license_url": "https://www.apache.org/licenses/LICENSE-2.0",
   "source": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX",
   "revision": "daa72c51243991dfcaf9f9137d2c573d8f7790c0",
   "bytes": 189538815,
   "files": [
    {
     "role": "config.json",
     "path": "config.json",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/config.json",
     "bytes": 5031,
     "sha256": "8d011bfe08b5e345bbe0b81e5c6fd02c381920b345b986047bc2a33ce7b90d1d"
    },
    {
     "role": "config_sentence_transformers.json",
     "path": "config_sentence_transformers.json",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/config_sentence_transformers.json",
     "bytes": 1565,
     "sha256": "031e56a498d33c349ab489a21885bcfe25b4fcba841149dc99e1e90d4a7c28f5"
    },
    {
     "role": "preprocessor_config.json",
     "path": "preprocessor_config.json",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/preprocessor_config.json",
     "bytes": 560,
     "sha256": "9344893f8d0573a46ebb2ca54c03f56d044cea194c8dcfb1f4d652240ac21daa"
    },
    {
     "role": "processor_config.json",
     "path": "processor_config.json",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/processor_config.json",
     "bytes": 1788,
     "sha256": "168f6a08522f3ce5dea596d94d003af2fd691742d4f41fe1f9d8cce76bfbf69c"
    },
    {
     "role": "tokenizer.json",
     "path": "tokenizer.json",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/tokenizer.json",
     "bytes": 32170510,
     "sha256": "4d777ef5bdc1aa36227abdfb77c3e49e7b9c892d16e1b6bda41c393504828be4"
    },
    {
     "role": "tokenizer_config.json",
     "path": "tokenizer_config.json",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/tokenizer_config.json",
     "bytes": 1599,
     "sha256": "17bd5d6e9364ca49a534e1502076593317c298d4a663623091ed45388f004874"
    },
    {
     "role": "onnx",
     "path": "onnx/model_q4f16.onnx",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/onnx/model_q4f16.onnx",
     "bytes": 495298,
     "sha256": "53feeced79582d661e30adeaa9829cea90d92b1c78347e26fd123773580f71d0"
    },
    {
     "role": "onnx_data",
     "path": "onnx/model_q4f16.onnx_data",
     "url": "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/daa72c51243991dfcaf9f9137d2c573d8f7790c0/onnx/model_q4f16.onnx_data",
     "bytes": 156862464,
     "sha256": "c39fbaa1fb4221f04beb82786a06b81999c514fd39e84fcd58ef79413c87fa56"
    }
   ],
   "modalities": [
    "text"
   ],
   "platforms": [
    "web"
   ],
   "min_memory_mb": 500,
   "space_version": "914f7f89+q4",
   "judge_calibration": null,
   "notes": null,
   "dtype": "q4f16",
   "published": true
  },
  {
   "id": "embeddinggemma-2-mlx-8bit",
   "name": "EmbeddingGemma 2 · MLX 8 bits",
   "family": "embeddinggemma-2",
   "kind": "embed",
   "kinds": [
    "embed"
   ],
   "engine": "mlx",
   "format": "mlx",
   "license": "Apache-2.0",
   "license_url": "https://www.apache.org/licenses/LICENSE-2.0",
   "source": "https://huggingface.co/mlx-community/embeddinggemma-2-8bit",
   "revision": "7505ef2f8ddef45efef6d060865f27989b3c9cec",
   "bytes": 1266578368,
   "files": [
    {
     "role": "file",
     "path": "1_Pooling/config.json",
     "url": "https://huggingface.co/mlx-community/embeddinggemma-2-8bit/resolve/7505ef2f8ddef45efef6d060865f27989b3c9cec/1_Pooling/config.json",
     "bytes": 90,
     "sha256": "8759bdf7c77efc7df7723f64856a593c8943b71ee38baf2a88771fbaf78438f9"
    },
    {
     "role": "file",
     "path": "2_Normalize/config.json",
     "url": "https://huggingface.co/mlx-community/embeddinggemma-2-8bit/resolve/7505ef2f8ddef45efef6d060865f27989b3c9cec/2_Normalize/config.json",
     "bytes": 97,
     "sha256": "cdb09dfca347a56aa2d691744e38d5ad3c7cbc2834e7181272b9a15328b82524"
    },
    {
     "role": "file",
     "path": "chat_template.jinja",
     "url": "https://huggingface.co/mlx-community/embeddinggemma-2-8bit/resolve/7505ef2f8ddef45efef6d060865f27989b3c9cec/chat_template.jinja",
     "bytes": 1016,
     "sha256": "4b852efc0b9960283e735363331e6f325b33bc74bdbaa076f595bc4e9b94d85e"
    },
    {
     "role": "file",
     "path": "config.json",
     "url": "https://huggingface.co/mlx-community/embeddinggemma-2-8bit/resolve/7505ef2f8ddef45efef6d060865f27989b3c9cec/config.json",
     "bytes": 5463,
     "sha256": "35e55812554bf172f9321f5c6a25d58810432db9eeeb38094723a04e8d3dd9af"
    },
    {
     "role": "file",
     "path": "config_sentence_transformers.json",
     "url": "https://huggingface.co/mlx-community/embeddinggemma-2-8bit/resolve/7505ef2f8ddef45efef6d060865f27989b3c9cec/config_sentence_transformers.json",
     "bytes": 1565,
     "sha256": "031e56a498d33c349ab489a21885bcfe25b4fcba841149dc99e1e90d4a7c28f5"
    },
    {
     "role": "model",
     "path": "model.safetensors",
     "url": "https://huggingface.co/mlx-community/embeddinggemma-2-8bit/resolve/7505ef2f8ddef45efef6d060865f27989b3c9cec/model.safetensors",
     "bytes": 1234238431,
     "sha256": "6b7e97f9687ad422ab3625a1cdf6002892187d7dd04d01b2a09253fa1e5d4cfd"
    },
    {
     "role": "file",
     "path": "model.safetensors.index.json",
     "url": "https://huggingface.co/mlx-community/embeddinggemma-2-8bit/resolve/7505ef2f8ddef45efef6d060865f27989b3c9cec/model.safetensors.index.json",
     "bytes": 153721,
     "sha256": "f7244e4a2294cec8281fd884ab93e0a1df53a24bd4de8ac9e5882743bd1c502c"
    },
    {
     "role": "file",
     "path": "modules.json",
     "url": "https://huggingface.co/mlx-community/embeddinggemma-2-8bit/resolve/7505ef2f8ddef45efef6d060865f27989b3c9cec/modules.json",
     "bytes": 413,
     "sha256": "3d02572a0455b832de67fb8e63a54981bc7e8b46e337c95e917bd8122a533bfd"
    },
    {
     "role": "file",
     "path": "preprocessor_config.json",
     "url": "https://huggingface.co/mlx-community/embeddinggemma-2-8bit/resolve/7505ef2f8ddef45efef6d060865f27989b3c9cec/preprocessor_config.json",
     "bytes": 511,
     "sha256": "ea2ae257e901064abdd98dceb19f2b0da06af600bed15e0f99f5c85c37ee9d78"
    },
    {
     "role": "file",
     "path": "processor_config.json",
     "url": "https://huggingface.co/mlx-community/embeddinggemma-2-8bit/resolve/7505ef2f8ddef45efef6d060865f27989b3c9cec/processor_config.json",
     "bytes": 1788,
     "sha256": "168f6a08522f3ce5dea596d94d003af2fd691742d4f41fe1f9d8cce76bfbf69c"
    },
    {
     "role": "file",
     "path": "sentence_bert_config.json",
     "url": "https://huggingface.co/mlx-community/embeddinggemma-2-8bit/resolve/7505ef2f8ddef45efef6d060865f27989b3c9cec/sentence_bert_config.json",
     "bytes": 747,
     "sha256": "b1bcd9f2dce3ae863b359e87d0710b5dbc3314a59ecb4e2f97c7778fc8e4b228"
    },
    {
     "role": "tokenizer",
     "path": "tokenizer.json",
     "url": "https://huggingface.co/mlx-community/embeddinggemma-2-8bit/resolve/7505ef2f8ddef45efef6d060865f27989b3c9cec/tokenizer.json",
     "bytes": 32170510,
     "sha256": "4d777ef5bdc1aa36227abdfb77c3e49e7b9c892d16e1b6bda41c393504828be4"
    },
    {
     "role": "tokenizer",
     "path": "tokenizer_config.json",
     "url": "https://huggingface.co/mlx-community/embeddinggemma-2-8bit/resolve/7505ef2f8ddef45efef6d060865f27989b3c9cec/tokenizer_config.json",
     "bytes": 1599,
     "sha256": "17bd5d6e9364ca49a534e1502076593317c298d4a663623091ed45388f004874"
    },
    {
     "role": "file",
     "path": "validation.json",
     "url": "https://huggingface.co/mlx-community/embeddinggemma-2-8bit/resolve/7505ef2f8ddef45efef6d060865f27989b3c9cec/validation.json",
     "bytes": 2417,
     "sha256": "7d8681a0a27d61cbad9b25bf788bc553a1345f153860c4b31c98b10906bbcac1"
    }
   ],
   "modalities": [
    "text",
    "image",
    "audio"
   ],
   "platforms": [
    "macos"
   ],
   "min_memory_mb": 1800,
   "space_version": "914f7f89",
   "judge_calibration": null,
   "notes": null,
   "published": true
  },
  {
   "id": "embeddinggemma-2-litert-text-270m",
   "name": "EmbeddingGemma 2 · LiteRT-LM texto 270M (CPU/GPU; variantes NPU en el repo)",
   "family": "embeddinggemma-2",
   "kind": "embed",
   "kinds": [
    "embed"
   ],
   "engine": "litert-lm",
   "format": "litertlm",
   "license": "Apache-2.0",
   "license_url": "https://www.apache.org/licenses/LICENSE-2.0",
   "source": "https://huggingface.co/litert-community/embeddinggemma-2-text-270m-litert-lm",
   "revision": "9be6e8b90982095dc05c2bd162e4b954ee4dbac7",
   "bytes": 164626432,
   "files": [
    {
     "role": "model",
     "path": "embeddinggemma-2-text-270m.litertlm",
     "url": "https://huggingface.co/litert-community/embeddinggemma-2-text-270m-litert-lm/resolve/9be6e8b90982095dc05c2bd162e4b954ee4dbac7/embeddinggemma-2-text-270m.litertlm",
     "bytes": 164626432,
     "sha256": "2d079ee2f6f066b1f368e8d7c819f55214eaef1d0513b312321901f30ab286fb"
    }
   ],
   "modalities": [
    "text"
   ],
   "platforms": [
    "android"
   ],
   "min_memory_mb": 400,
   "space_version": null,
   "judge_calibration": null,
   "notes": "Sin medir: LiteRT-LM no corre en macOS en este banco. Variantes NPU: _Google_Tensor_G5/G6, _Qualcomm_SM8550…SM8850, _MediaTek_MT6991/MT6993.",
   "published": true
  },
  {
   "id": "embeddinggemma-2-st-reference",
   "name": "EmbeddingGemma 2 · safetensors bf16 (referencia, sentence-transformers)",
   "family": "embeddinggemma-2",
   "kind": "embed",
   "kinds": [
    "embed"
   ],
   "engine": "sentence-transformers",
   "format": "safetensors",
   "license": "Apache-2.0",
   "license_url": "https://www.apache.org/licenses/LICENSE-2.0",
   "source": "https://huggingface.co/google/embeddinggemma-2",
   "revision": "914f7f89142e33e77833254d9c9b90c3cef7303b",
   "bytes": 1525787092,
   "files": [
    {
     "role": "file",
     "path": "1_Pooling/config.json",
     "url": "https://huggingface.co/google/embeddinggemma-2/resolve/914f7f89142e33e77833254d9c9b90c3cef7303b/1_Pooling/config.json",
     "bytes": 90,
     "sha256": "8759bdf7c77efc7df7723f64856a593c8943b71ee38baf2a88771fbaf78438f9"
    },
    {
     "role": "file",
     "path": "2_Normalize/config.json",
     "url": "https://huggingface.co/google/embeddinggemma-2/resolve/914f7f89142e33e77833254d9c9b90c3cef7303b/2_Normalize/config.json",
     "bytes": 97,
     "sha256": "cdb09dfca347a56aa2d691744e38d5ad3c7cbc2834e7181272b9a15328b82524"
    },
    {
     "role": "file",
     "path": "chat_template.jinja",
     "url": "https://huggingface.co/google/embeddinggemma-2/resolve/914f7f89142e33e77833254d9c9b90c3cef7303b/chat_template.jinja",
     "bytes": 1016,
     "sha256": "4b852efc0b9960283e735363331e6f325b33bc74bdbaa076f595bc4e9b94d85e"
    },
    {
     "role": "file",
     "path": "config.json",
     "url": "https://huggingface.co/google/embeddinggemma-2/resolve/914f7f89142e33e77833254d9c9b90c3cef7303b/config.json",
     "bytes": 4455,
     "sha256": "b8f1e9931b57fbc054acdb445c41765d55b0074c58d145fa82839941ad1b5bb3"
    },
    {
     "role": "file",
     "path": "config_sentence_transformers.json",
     "url": "https://huggingface.co/google/embeddinggemma-2/resolve/914f7f89142e33e77833254d9c9b90c3cef7303b/config_sentence_transformers.json",
     "bytes": 1565,
     "sha256": "031e56a498d33c349ab489a21885bcfe25b4fcba841149dc99e1e90d4a7c28f5"
    },
    {
     "role": "model",
     "path": "model.safetensors",
     "url": "https://huggingface.co/google/embeddinggemma-2/resolve/914f7f89142e33e77833254d9c9b90c3cef7303b/model.safetensors",
     "bytes": 1488915288,
     "sha256": "197a32965d4b1105faf060417baa899e193fb73cd401f42ec9295234d5553d79"
    },
    {
     "role": "file",
     "path": "modules.json",
     "url": "https://huggingface.co/google/embeddinggemma-2/resolve/914f7f89142e33e77833254d9c9b90c3cef7303b/modules.json",
     "bytes": 413,
     "sha256": "3d02572a0455b832de67fb8e63a54981bc7e8b46e337c95e917bd8122a533bfd"
    },
    {
     "role": "file",
     "path": "preprocessor_config.json",
     "url": "https://huggingface.co/google/embeddinggemma-2/resolve/914f7f89142e33e77833254d9c9b90c3cef7303b/preprocessor_config.json",
     "bytes": 511,
     "sha256": "ea2ae257e901064abdd98dceb19f2b0da06af600bed15e0f99f5c85c37ee9d78"
    },
    {
     "role": "file",
     "path": "processor_config.json",
     "url": "https://huggingface.co/google/embeddinggemma-2/resolve/914f7f89142e33e77833254d9c9b90c3cef7303b/processor_config.json",
     "bytes": 1788,
     "sha256": "168f6a08522f3ce5dea596d94d003af2fd691742d4f41fe1f9d8cce76bfbf69c"
    },
    {
     "role": "file",
     "path": "sentence_bert_config.json",
     "url": "https://huggingface.co/google/embeddinggemma-2/resolve/914f7f89142e33e77833254d9c9b90c3cef7303b/sentence_bert_config.json",
     "bytes": 747,
     "sha256": "b1bcd9f2dce3ae863b359e87d0710b5dbc3314a59ecb4e2f97c7778fc8e4b228"
    },
    {
     "role": "tokenizer",
     "path": "tokenizer.json",
     "url": "https://huggingface.co/google/embeddinggemma-2/resolve/914f7f89142e33e77833254d9c9b90c3cef7303b/tokenizer.json",
     "bytes": 32170510,
     "sha256": "4d777ef5bdc1aa36227abdfb77c3e49e7b9c892d16e1b6bda41c393504828be4"
    },
    {
     "role": "tokenizer",
     "path": "tokenizer.model",
     "url": "https://huggingface.co/google/embeddinggemma-2/resolve/914f7f89142e33e77833254d9c9b90c3cef7303b/tokenizer.model",
     "bytes": 4689013,
     "sha256": "e594c8a90eb08d8bda498ff4747977dc827ae0c3c56b5c0d41a605a22d02ef03"
    },
    {
     "role": "tokenizer",
     "path": "tokenizer_config.json",
     "url": "https://huggingface.co/google/embeddinggemma-2/resolve/914f7f89142e33e77833254d9c9b90c3cef7303b/tokenizer_config.json",
     "bytes": 1599,
     "sha256": "17bd5d6e9364ca49a534e1502076593317c298d4a663623091ed45388f004874"
    }
   ],
   "modalities": [
    "text",
    "image",
    "audio",
    "video"
   ],
   "platforms": [
    "macos",
    "windows",
    "linux"
   ],
   "min_memory_mb": 4000,
   "space_version": "914f7f89",
   "judge_calibration": null,
   "notes": null,
   "published": true
  },
  {
   "id": "gemma-4-e2b-it-gguf-q4_k_m",
   "name": "Gemma 4 E2B instruct · GGUF Q4_K_M",
   "family": "gemma-4-e2b",
   "kind": "generate",
   "kinds": [
    "generate",
    "judge"
   ],
   "engine": "llama.cpp",
   "format": "gguf",
   "license": "Apache-2.0",
   "license_url": "https://www.apache.org/licenses/LICENSE-2.0",
   "source": "https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF",
   "revision": "0314792d7f1f7e229411f620751375812bb9faf2",
   "bytes": 3106738272,
   "files": [
    {
     "role": "model",
     "path": "gemma-4-E2B-it-Q4_K_M.gguf",
     "url": "https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/0314792d7f1f7e229411f620751375812bb9faf2/gemma-4-E2B-it-Q4_K_M.gguf",
     "bytes": 3106738272,
     "sha256": "740185b21d22ceb83a11c3aa62ad5842ef32c70f6096d756bbee85a1e4ec34b8"
    }
   ],
   "modalities": [
    "text"
   ],
   "platforms": [
    "macos",
    "windows",
    "linux",
    "ios",
    "android"
   ],
   "min_memory_mb": 4000,
   "space_version": null,
   "judge_calibration": {
    "choice": {
     "temperature": 3.669,
     "prior_correction": false
    },
    "noul": {
     "temperature": 3.888,
     "prior_correction": false
    }
   },
   "notes": null,
   "published": true
  },
  {
   "id": "gemma-4-e4b-it-gguf-q4_k_m",
   "name": "Gemma 4 E4B instruct · GGUF Q4_K_M",
   "family": "gemma-4-e4b",
   "kind": "generate",
   "kinds": [
    "generate",
    "judge"
   ],
   "engine": "llama.cpp",
   "format": "gguf",
   "license": "Apache-2.0",
   "license_url": "https://www.apache.org/licenses/LICENSE-2.0",
   "source": "https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF",
   "revision": "bfc15c382204943c3a8fff0c750b94ae2364d7a3",
   "bytes": 4977171584,
   "files": [
    {
     "role": "model",
     "path": "gemma-4-E4B-it-Q4_K_M.gguf",
     "url": "https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/bfc15c382204943c3a8fff0c750b94ae2364d7a3/gemma-4-E4B-it-Q4_K_M.gguf",
     "bytes": 4977171584,
     "sha256": "85a896a047553e842f25297ee5b031d64ff30147d9c4af17b1e4b394cd1fab87"
    }
   ],
   "modalities": [
    "text"
   ],
   "platforms": [
    "macos",
    "windows",
    "linux",
    "ios",
    "android"
   ],
   "min_memory_mb": 6500,
   "space_version": null,
   "judge_calibration": {
    "choice": {
     "temperature": 4.12,
     "prior_correction": false
    },
    "noul": {
     "temperature": 3.669,
     "prior_correction": false
    }
   },
   "notes": null,
   "published": true
  },
  {
   "id": "gemma-4-e2b-it-web",
   "name": "Gemma 4 E2B instruct · LiteRT web (.task, MediaPipe GenAI)",
   "family": "gemma-4-e2b",
   "kind": "generate",
   "kinds": [
    "generate"
   ],
   "engine": "mediapipe",
   "format": "task",
   "license": "Apache-2.0",
   "license_url": "https://www.apache.org/licenses/LICENSE-2.0",
   "source": "https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm",
   "revision": "b3ca0d2f076785a8f4b2219ddbd2bdb99954eae1",
   "bytes": 2003697664,
   "files": [
    {
     "role": "task",
     "path": "gemma-4-E2B-it-web.task",
     "url": "https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/b3ca0d2f076785a8f4b2219ddbd2bdb99954eae1/gemma-4-E2B-it-web.task",
     "bytes": 2003697664,
     "sha256": "2cbff161177a4d51c9d04360016185976f504517ba5758cd10c1564e5421c5a5"
    }
   ],
   "modalities": [
    "text"
   ],
   "platforms": [
    "web"
   ],
   "min_memory_mb": 4000,
   "space_version": null,
   "judge_calibration": null,
   "notes": null,
   "published": true
  },
  {
   "id": "gemma-4-e4b-it-web",
   "name": "Gemma 4 E4B instruct · LiteRT web (.task)",
   "family": "gemma-4-e4b",
   "kind": "generate",
   "kinds": [
    "generate"
   ],
   "engine": "mediapipe",
   "format": "task",
   "license": "Apache-2.0",
   "license_url": "https://www.apache.org/licenses/LICENSE-2.0",
   "source": "https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm",
   "revision": "2eee7ac325f20eb8c9ac1d0e972f7c84663062da",
   "bytes": 2964324352,
   "files": [
    {
     "role": "task",
     "path": "gemma-4-E4B-it-web.task",
     "url": "https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm/resolve/2eee7ac325f20eb8c9ac1d0e972f7c84663062da/gemma-4-E4B-it-web.task",
     "bytes": 2964324352,
     "sha256": "f3bd72fc27627be2a2cc6722199a333599590ed0962ee7047b516a506b7bf086"
    }
   ],
   "modalities": [
    "text"
   ],
   "platforms": [
    "web"
   ],
   "min_memory_mb": 6000,
   "space_version": null,
   "judge_calibration": null,
   "notes": null,
   "published": true
  },
  {
   "id": "gemma-4-e2b-it-onnx-q4f16",
   "name": "Gemma 4 E2B instruct · ONNX q4f16 (transformers.js, juez web por logits)",
   "family": "gemma-4-e2b",
   "kind": "judge",
   "kinds": [
    "judge"
   ],
   "engine": "transformers.js",
   "format": "onnx",
   "license": "Apache-2.0",
   "license_url": "https://www.apache.org/licenses/LICENSE-2.0",
   "source": "https://huggingface.co/onnx-community/gemma-4-E2B-it-ONNX",
   "revision": "9f4bef82ea6e296bc69f8a2f5939f73af81b07a6",
   "bytes": 3130549798,
   "files": [
    {
     "role": "config.json",
     "path": "config.json",
     "url": "https://huggingface.co/onnx-community/gemma-4-E2B-it-ONNX/resolve/9f4bef82ea6e296bc69f8a2f5939f73af81b07a6/config.json",
     "bytes": 5549,
     "sha256": "5494e6677d9e150ea20ba3101ae8a32b0f141004626f052725d8bf48991b9faa"
    },
    {
     "role": "generation_config.json",
     "path": "generation_config.json",
     "url": "https://huggingface.co/onnx-community/gemma-4-E2B-it-ONNX/resolve/9f4bef82ea6e296bc69f8a2f5939f73af81b07a6/generation_config.json",
     "bytes": 238,
     "sha256": "e6a0b50de21a511f15ac4857b7f227f68ee60ecb1f11255d07b75e0bdc60e155"
    },
    {
     "role": "tokenizer.json",
     "path": "tokenizer.json",
     "url": "https://huggingface.co/onnx-community/gemma-4-E2B-it-ONNX/resolve/9f4bef82ea6e296bc69f8a2f5939f73af81b07a6/tokenizer.json",
     "bytes": 19439251,
     "sha256": "47bd35616c7c782aaca6ccf48c75f3461d5877170984b8836b375107d0a9f566"
    },
    {
     "role": "tokenizer_config.json",
     "path": "tokenizer_config.json",
     "url": "https://huggingface.co/onnx-community/gemma-4-E2B-it-ONNX/resolve/9f4bef82ea6e296bc69f8a2f5939f73af81b07a6/tokenizer_config.json",
     "bytes": 18807,
     "sha256": "06afbf54e228050cba79c4a0afd83543cc89070a2d62b8337d0aa8b4cdc348c3"
    },
    {
     "role": "chat_template.jinja",
     "path": "chat_template.jinja",
     "url": "https://huggingface.co/onnx-community/gemma-4-E2B-it-ONNX/resolve/9f4bef82ea6e296bc69f8a2f5939f73af81b07a6/chat_template.jinja",
     "bytes": 16317,
     "sha256": "781d10940fbc44be40064b5d43a056fc486c84ceaa55538226368b57314132bf"
    },
    {
     "role": "onnx",
     "path": "onnx/decoder_model_merged_q4f16.onnx",
     "url": "https://huggingface.co/onnx-community/gemma-4-E2B-it-ONNX/resolve/9f4bef82ea6e296bc69f8a2f5939f73af81b07a6/onnx/decoder_model_merged_q4f16.onnx",
     "bytes": 673231,
     "sha256": "73c0f1fe04f9a3a048fb3319c0671b6cf0346bf33a3a8624c853bcffe01c24a4"
    },
    {
     "role": "onnx_data",
     "path": "onnx/decoder_model_merged_q4f16.onnx_data",
     "url": "https://huggingface.co/onnx-community/gemma-4-E2B-it-ONNX/resolve/9f4bef82ea6e296bc69f8a2f5939f73af81b07a6/onnx/decoder_model_merged_q4f16.onnx_data",
     "bytes": 1519700992,
     "sha256": "3b27245a7396cb7039a4e4118bd2a8aa35106bae381522edf7c4867b5f22bb10"
    },
    {
     "role": "onnx",
     "path": "onnx/embed_tokens_q4f16.onnx",
     "url": "https://huggingface.co/onnx-community/gemma-4-E2B-it-ONNX/resolve/9f4bef82ea6e296bc69f8a2f5939f73af81b07a6/onnx/embed_tokens_q4f16.onnx",
     "bytes": 5621,
     "sha256": "d7ca53f6a169471b5699b2f57ee4c7aa2c73732b0152f3909e64b71384444825"
    },
    {
     "role": "onnx_data",
     "path": "onnx/embed_tokens_q4f16.onnx_data",
     "url": "https://huggingface.co/onnx-community/gemma-4-E2B-it-ONNX/resolve/9f4bef82ea6e296bc69f8a2f5939f73af81b07a6/onnx/embed_tokens_q4f16.onnx_data",
     "bytes": 1590689792,
     "sha256": "024b199e6358ed42970f807686add5f9430d7e254ca7ce22fc9c83f015b9c517"
    }
   ],
   "modalities": [
    "text"
   ],
   "platforms": [
    "web"
   ],
   "min_memory_mb": 6000,
   "space_version": null,
   "judge_calibration": {
    "choice": {
     "temperature": 6.947,
     "prior_correction": false
    },
    "noul": {
     "temperature": 5.837,
     "prior_correction": false
    }
   },
   "notes": null,
   "dtype": "q4f16",
   "published": true
  },
  {
   "id": "gemma-4-e2b-it-litert-lm",
   "name": "Gemma 4 E2B instruct · LiteRT-LM (Android CPU/GPU)",
   "family": "gemma-4-e2b",
   "kind": "generate",
   "kinds": [
    "generate"
   ],
   "engine": "litert-lm",
   "format": "litertlm",
   "license": "Apache-2.0",
   "license_url": "https://www.apache.org/licenses/LICENSE-2.0",
   "source": "https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm",
   "revision": "b3ca0d2f076785a8f4b2219ddbd2bdb99954eae1",
   "bytes": 2588147712,
   "files": [
    {
     "role": "model",
     "path": "gemma-4-E2B-it.litertlm",
     "url": "https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/b3ca0d2f076785a8f4b2219ddbd2bdb99954eae1/gemma-4-E2B-it.litertlm",
     "bytes": 2588147712,
     "sha256": "181938105e0eefd105961417e8da75903eacda102c4fce9ce90f50b97139a63c"
    }
   ],
   "modalities": [
    "text"
   ],
   "platforms": [
    "android"
   ],
   "min_memory_mb": 4000,
   "space_version": null,
   "judge_calibration": null,
   "notes": "Variantes NPU en el repo: _Google_Tensor_G5/G6, _qualcomm_sm8750, _qualcomm_qcs8275, _intel_LNL/PTL.",
   "published": true
  },
  {
   "id": "gemma-4-e2b-it-mlx-4bit",
   "name": "Gemma 4 E2B instruct · MLX 4 bits",
   "family": "gemma-4-e2b",
   "kind": "generate",
   "kinds": [
    "generate"
   ],
   "engine": "mlx",
   "format": "mlx",
   "license": "Apache-2.0",
   "license_url": "https://www.apache.org/licenses/LICENSE-2.0",
   "source": "https://huggingface.co/lmstudio-community/gemma-4-E2B-it-MLX-4bit",
   "revision": "31512dab743c73974a99795270031a6f85072d94",
   "bytes": 4372357035,
   "files": [
    {
     "role": "file",
     "path": "chat_template.jinja",
     "url": "https://huggingface.co/lmstudio-community/gemma-4-E2B-it-MLX-4bit/resolve/31512dab743c73974a99795270031a6f85072d94/chat_template.jinja",
     "bytes": 16317,
     "sha256": "781d10940fbc44be40064b5d43a056fc486c84ceaa55538226368b57314132bf"
    },
    {
     "role": "file",
     "path": "config.json",
     "url": "https://huggingface.co/lmstudio-community/gemma-4-E2B-it-MLX-4bit/resolve/31512dab743c73974a99795270031a6f85072d94/config.json",
     "bytes": 31206,
     "sha256": "7bb97d083794a22b94c8481558ac9a7f99d72eb330c2d1e5b3a701255abb0425"
    },
    {
     "role": "file",
     "path": "generation_config.json",
     "url": "https://huggingface.co/lmstudio-community/gemma-4-E2B-it-MLX-4bit/resolve/31512dab743c73974a99795270031a6f85072d94/generation_config.json",
     "bytes": 208,
     "sha256": "d4226bbe3117d2d253ba4609720ba82c6c4ce4627a9a6ae05387c78983ac03de"
    },
    {
     "role": "model",
     "path": "model.safetensors",
     "url": "https://huggingface.co/lmstudio-community/gemma-4-E2B-it-MLX-4bit/resolve/31512dab743c73974a99795270031a6f85072d94/model.safetensors",
     "bytes": 4339886573,
     "sha256": "54dfb6c99a9778a68dd5f3300f13930e65b567dab1ac54340001086bcf65a692"
    },
    {
     "role": "file",
     "path": "model.safetensors.index.json",
     "url": "https://huggingface.co/lmstudio-community/gemma-4-E2B-it-MLX-4bit/resolve/31512dab743c73974a99795270031a6f85072d94/model.safetensors.index.json",
     "bytes": 230503,
     "sha256": "08f854b97fefc68d39c0d2066240e3c9efdf76b9255c18da3065f91cafd01b5d"
    },
    {
     "role": "file",
     "path": "processor_config.json",
     "url": "https://huggingface.co/lmstudio-community/gemma-4-E2B-it-MLX-4bit/resolve/31512dab743c73974a99795270031a6f85072d94/processor_config.json",
     "bytes": 902,
     "sha256": "1bd0d00776284f369c1eff5fb631e865dfcdca861e0b7d60dbef27fcf37436a8"
    },
    {
     "role": "tokenizer",
     "path": "tokenizer.json",
     "url": "https://huggingface.co/lmstudio-community/gemma-4-E2B-it-MLX-4bit/resolve/31512dab743c73974a99795270031a6f85072d94/tokenizer.json",
     "bytes": 32169626,
     "sha256": "cc8d3a0ce36466ccc1278bf987df5f71db1719b9ca6b4118264f45cb627bfe0f"
    },
    {
     "role": "tokenizer",
     "path": "tokenizer_config.json",
     "url": "https://huggingface.co/lmstudio-community/gemma-4-E2B-it-MLX-4bit/resolve/31512dab743c73974a99795270031a6f85072d94/tokenizer_config.json",
     "bytes": 21700,
     "sha256": "16f4a5a617a11af24b4bf474109800989e7d2b5b1ca22f73a561ec2398308e8d"
    }
   ],
   "modalities": [
    "text"
   ],
   "platforms": [
    "macos"
   ],
   "min_memory_mb": 5500,
   "space_version": null,
   "judge_calibration": null,
   "notes": null,
   "published": true
  },
  {
   "id": "gemma-4-e4b-it-mlx-4bit",
   "name": "Gemma 4 E4B instruct · MLX 4 bits",
   "family": "gemma-4-e4b",
   "kind": "generate",
   "kinds": [
    "generate"
   ],
   "engine": "mlx",
   "format": "mlx",
   "license": "Apache-2.0",
   "license_url": "https://www.apache.org/licenses/LICENSE-2.0",
   "source": "https://huggingface.co/lmstudio-community/gemma-4-E4B-it-MLX-4bit",
   "revision": "ce713a0013bb7090305edfb8e3773a07ccae35c1",
   "bytes": 6861841107,
   "files": [
    {
     "role": "file",
     "path": "chat_template.jinja",
     "url": "https://huggingface.co/lmstudio-community/gemma-4-E4B-it-MLX-4bit/resolve/ce713a0013bb7090305edfb8e3773a07ccae35c1/chat_template.jinja",
     "bytes": 16317,
     "sha256": "781d10940fbc44be40064b5d43a056fc486c84ceaa55538226368b57314132bf"
    },
    {
     "role": "file",
     "path": "config.json",
     "url": "https://huggingface.co/lmstudio-community/gemma-4-E4B-it-MLX-4bit/resolve/ce713a0013bb7090305edfb8e3773a07ccae35c1/config.json",
     "bytes": 36493,
     "sha256": "8b2b956fab049146585c693a08d1cd625cef8c84d8eb7ea556cf826d0565b92a"
    },
    {
     "role": "file",
     "path": "generation_config.json",
     "url": "https://huggingface.co/lmstudio-community/gemma-4-E4B-it-MLX-4bit/resolve/ce713a0013bb7090305edfb8e3773a07ccae35c1/generation_config.json",
     "bytes": 208,
     "sha256": "d4226bbe3117d2d253ba4609720ba82c6c4ce4627a9a6ae05387c78983ac03de"
    },
    {
     "role": "model",
     "path": "model-00001-of-00002.safetensors",
     "url": "https://huggingface.co/lmstudio-community/gemma-4-E4B-it-MLX-4bit/resolve/ce713a0013bb7090305edfb8e3773a07ccae35c1/model-00001-of-00002.safetensors",
     "bytes": 4280494809,
     "sha256": "e58e5ed66324cdc0ce22f51d4d71a9b2db8c24f666278d1b71c3440a18c0f163"
    },
    {
     "role": "model",
     "path": "model-00002-of-00002.safetensors",
     "url": "https://huggingface.co/lmstudio-community/gemma-4-E4B-it-MLX-4bit/resolve/ce713a0013bb7090305edfb8e3773a07ccae35c1/model-00002-of-00002.safetensors",
     "bytes": 2548805689,
     "sha256": "5ae9ab6d6e86dd4d8f7eb6957eb7ad151121431df3855516e89c185824d640cf"
    },
    {
     "role": "file",
     "path": "model.safetensors.index.json",
     "url": "https://huggingface.co/lmstudio-community/gemma-4-E4B-it-MLX-4bit/resolve/ce713a0013bb7090305edfb8e3773a07ccae35c1/model.safetensors.index.json",
     "bytes": 295363,
     "sha256": "edfcf22ac78bded1b0518358c2672596f9267d361c433fad7e593f7238bc15cb"
    },
    {
     "role": "file",
     "path": "processor_config.json",
     "url": "https://huggingface.co/lmstudio-community/gemma-4-E4B-it-MLX-4bit/resolve/ce713a0013bb7090305edfb8e3773a07ccae35c1/processor_config.json",
     "bytes": 902,
     "sha256": "1bd0d00776284f369c1eff5fb631e865dfcdca861e0b7d60dbef27fcf37436a8"
    },
    {
     "role": "tokenizer",
     "path": "tokenizer.json",
     "url": "https://huggingface.co/lmstudio-community/gemma-4-E4B-it-MLX-4bit/resolve/ce713a0013bb7090305edfb8e3773a07ccae35c1/tokenizer.json",
     "bytes": 32169626,
     "sha256": "cc8d3a0ce36466ccc1278bf987df5f71db1719b9ca6b4118264f45cb627bfe0f"
    },
    {
     "role": "tokenizer",
     "path": "tokenizer_config.json",
     "url": "https://huggingface.co/lmstudio-community/gemma-4-E4B-it-MLX-4bit/resolve/ce713a0013bb7090305edfb8e3773a07ccae35c1/tokenizer_config.json",
     "bytes": 21700,
     "sha256": "16f4a5a617a11af24b4bf474109800989e7d2b5b1ca22f73a561ec2398308e8d"
    }
   ],
   "modalities": [
    "text"
   ],
   "platforms": [
    "macos"
   ],
   "min_memory_mb": 8000,
   "space_version": null,
   "judge_calibration": null,
   "notes": null,
   "published": true
  },
  {
   "id": "valen-0.8b-server",
   "name": "Valen 0.8B · safetensors (servidor Python opcional)",
   "family": "valen-0.8b",
   "kind": "judge",
   "kinds": [
    "judge"
   ],
   "engine": "server",
   "format": "safetensors",
   "license": "Apache-2.0",
   "license_url": "https://www.apache.org/licenses/LICENSE-2.0",
   "source": "https://huggingface.co/Valen-Team/Valen-0.8B",
   "revision": "4c858f2e26f4978640fa3f6d0de26a75b790b661",
   "bytes": 3437354137,
   "files": [
    {
     "role": "file",
     "path": "COMPLETE.json",
     "url": "https://huggingface.co/Valen-Team/Valen-0.8B/resolve/4c858f2e26f4978640fa3f6d0de26a75b790b661/COMPLETE.json",
     "bytes": 171,
     "sha256": "3ba4ff3b93654886d23e5ff3589a1b0424c4be16710806e017a0424509c1ccfc"
    },
    {
     "role": "file",
     "path": "LICENSE",
     "url": "https://huggingface.co/Valen-Team/Valen-0.8B/resolve/4c858f2e26f4978640fa3f6d0de26a75b790b661/LICENSE",
     "bytes": 11544,
     "sha256": "bbedc3fda3305820b977265f01b8619d87570a6739de3a5582c3464840f1e57a"
    },
    {
     "role": "file",
     "path": "batching.py",
     "url": "https://huggingface.co/Valen-Team/Valen-0.8B/resolve/4c858f2e26f4978640fa3f6d0de26a75b790b661/batching.py",
     "bytes": 2953,
     "sha256": "ea45d4724bcafca559fc5a2a18092918b633746771c19da6554c29bc5f2cef64"
    },
    {
     "role": "file",
     "path": "chat_template.jinja",
     "url": "https://huggingface.co/Valen-Team/Valen-0.8B/resolve/4c858f2e26f4978640fa3f6d0de26a75b790b661/chat_template.jinja",
     "bytes": 7755,
     "sha256": "273d8e0e683b885071fb17e08d71e5f2a5ddfb5309756181681de4f5a1822d80"
    },
    {
     "role": "file",
     "path": "compiler.py",
     "url": "https://huggingface.co/Valen-Team/Valen-0.8B/resolve/4c858f2e26f4978640fa3f6d0de26a75b790b661/compiler.py",
     "bytes": 13627,
     "sha256": "f35bab2e71b6beb1228daaa5b7baecdacf04eaf713aee14e8082b97090f910b4"
    },
    {
     "role": "file",
     "path": "config.json",
     "url": "https://huggingface.co/Valen-Team/Valen-0.8B/resolve/4c858f2e26f4978640fa3f6d0de26a75b790b661/config.json",
     "bytes": 3333,
     "sha256": "8a6a766acfe35a6eb3d373e90c43af0f08dbd44301251df71e18b1b5b5381c08"
    },
    {
     "role": "file",
     "path": "configuration_valen.py",
     "url": "https://huggingface.co/Valen-Team/Valen-0.8B/resolve/4c858f2e26f4978640fa3f6d0de26a75b790b661/configuration_valen.py",
     "bytes": 1003,
     "sha256": "8aa80266e8c328b5251d969de80f58e706dcd15a535c877108aab452ff572279"
    },
    {
     "role": "file",
     "path": "data_types.py",
     "url": "https://huggingface.co/Valen-Team/Valen-0.8B/resolve/4c858f2e26f4978640fa3f6d0de26a75b790b661/data_types.py",
     "bytes": 258,
     "sha256": "b06ce08081d8f7b2bf36abf302410a96086395e75a04f9e9b1c591db519b1641"
    },
    {
     "role": "file",
     "path": "export_manifest.json",
     "url": "https://huggingface.co/Valen-Team/Valen-0.8B/resolve/4c858f2e26f4978640fa3f6d0de26a75b790b661/export_manifest.json",
     "bytes": 3672,
     "sha256": "9fd6020bb60dd57ff541fd63252b4467e162279b1f53a176fe16e872416bcbad"
    },
    {
     "role": "file",
     "path": "heads.py",
     "url": "https://huggingface.co/Valen-Team/Valen-0.8B/resolve/4c858f2e26f4978640fa3f6d0de26a75b790b661/heads.py",
     "bytes": 6605,
     "sha256": "63b5970a8bfa121eff94d50ffd35e1fa8387f3af5abccc5f5b75381fb084fc34"
    },
    {
     "role": "model",
     "path": "model.safetensors",
     "url": "https://huggingface.co/Valen-Team/Valen-0.8B/resolve/4c858f2e26f4978640fa3f6d0de26a75b790b661/model.safetensors",
     "bytes": 3417285852,
     "sha256": "465714dd28702c4232d9233c2a2157d366967c541b2a27d9dadccc816304fd48"
    },
    {
     "role": "file",
     "path": "modeling_valen.py",
     "url": "https://huggingface.co/Valen-Team/Valen-0.8B/resolve/4c858f2e26f4978640fa3f6d0de26a75b790b661/modeling_valen.py",
     "bytes": 4553,
     "sha256": "851f90a089c23060e321e1da192689fd3b405253f219f67723bf57c873612d62"
    },
    {
     "role": "file",
     "path": "processor_config.json",
     "url": "https://huggingface.co/Valen-Team/Valen-0.8B/resolve/4c858f2e26f4978640fa3f6d0de26a75b790b661/processor_config.json",
     "bytes": 1191,
     "sha256": "d89ef49ce9cd37fbf510158e13c1ef063d9286411c1ec9049932dbe0487143b1"
    },
    {
     "role": "file",
     "path": "responses.py",
     "url": "https://huggingface.co/Valen-Team/Valen-0.8B/resolve/4c858f2e26f4978640fa3f6d0de26a75b790b661/responses.py",
     "bytes": 1542,
     "sha256": "298016b0070f1000a38d033e1048e038ff5df6fc1dcbe830601105b181f1d228"
    },
    {
     "role": "file",
     "path": "runtime_model.py",
     "url": "https://huggingface.co/Valen-Team/Valen-0.8B/resolve/4c858f2e26f4978640fa3f6d0de26a75b790b661/runtime_model.py",
     "bytes": 5554,
     "sha256": "2ce5808373505105bedc254bd99671fbeea43c25483e6b63add77b9e32d7baaf"
    },
    {
     "role": "file",
     "path": "schema.py",
     "url": "https://huggingface.co/Valen-Team/Valen-0.8B/resolve/4c858f2e26f4978640fa3f6d0de26a75b790b661/schema.py",
     "bytes": 3385,
     "sha256": "81659cc31b9673f6b9482095a4bbf6a2fb0b1415f0dfdd1c057278ecdca13595"
    },
    {
     "role": "tokenizer",
     "path": "tokenizer.json",
     "url": "https://huggingface.co/Valen-Team/Valen-0.8B/resolve/4c858f2e26f4978640fa3f6d0de26a75b790b661/tokenizer.json",
     "bytes": 19989343,
     "sha256": "87a7830d63fcf43bf241c3c5242e96e62dd3fdc29224ca26fed8ea333db72de4"
    },
    {
     "role": "tokenizer",
     "path": "tokenizer_config.json",
     "url": "https://huggingface.co/Valen-Team/Valen-0.8B/resolve/4c858f2e26f4978640fa3f6d0de26a75b790b661/tokenizer_config.json",
     "bytes": 1139,
     "sha256": "e98f1901ac6f0adff67b1d540bfa0c36ac1a0cf59eb72ed78146ef89aafa1182"
    },
    {
     "role": "file",
     "path": "validation.json",
     "url": "https://huggingface.co/Valen-Team/Valen-0.8B/resolve/4c858f2e26f4978640fa3f6d0de26a75b790b661/validation.json",
     "bytes": 10657,
     "sha256": "769290cb9e601b743b4cea58b4965301d660e967a6b6c6d05d6689b24c6563a2"
    }
   ],
   "modalities": [
    "text",
    "image",
    "video"
   ],
   "platforms": [
    "macos",
    "windows",
    "linux"
   ],
   "min_memory_mb": 6000,
   "space_version": null,
   "judge_calibration": null,
   "notes": "models/valen/server.py; trust_remote_code (código del repo, fijado por revisión).",
   "published": true
  },
  {
   "id": "valen-0.8b-onnx-int8",
   "name": "Valen 0.8B · ONNX int8 (onnxruntime nativo)",
   "family": "valen-0.8b",
   "kind": "judge",
   "kinds": [
    "judge"
   ],
   "engine": "onnxruntime",
   "format": "onnx",
   "license": "Apache-2.0",
   "license_url": "https://www.apache.org/licenses/LICENSE-2.0",
   "source": "https://huggingface.co/spdf-format/valen-0.8b-onnx",
   "revision": "main",
   "bytes": 781946172,
   "files": [
    {
     "role": "onnx",
     "path": "valen_backbone_int8.onnx",
     "url": "https://huggingface.co/spdf-format/valen-0.8b-onnx/resolve/main/valen_backbone_int8.onnx",
     "bytes": 1013137,
     "sha256": "cf23656a4c0e6ef769862e2ec823f2399068126ec5c5380898029bfb51e4707a"
    },
    {
     "role": "onnx_data",
     "path": "valen_backbone_int8.onnx.data",
     "url": "https://huggingface.co/spdf-format/valen-0.8b-onnx/resolve/main/valen_backbone_int8.onnx.data",
     "bytes": 755646464,
     "sha256": "069af8624a785f7868675ccc385cea227cf7e70d0a0b565e9fe6ac408912f850"
    },
    {
     "role": "head",
     "path": "valen_head.onnx",
     "url": "https://huggingface.co/spdf-format/valen-0.8b-onnx/resolve/main/valen_head.onnx",
     "bytes": 5292756,
     "sha256": "e7624dd82b1c674229c4b336df6ce04c5b1dd85cade9dde04186c0a40c8b1df1"
    },
    {
     "role": "tokenizer",
     "path": "tokenizer.json",
     "url": "https://huggingface.co/spdf-format/valen-0.8b-onnx/resolve/main/tokenizer.json",
     "bytes": 19989343,
     "sha256": "87a7830d63fcf43bf241c3c5242e96e62dd3fdc29224ca26fed8ea333db72de4"
    },
    {
     "role": "tokenizer_config",
     "path": "tokenizer_config.json",
     "url": "https://huggingface.co/spdf-format/valen-0.8b-onnx/resolve/main/tokenizer_config.json",
     "bytes": 1139,
     "sha256": "e98f1901ac6f0adff67b1d540bfa0c36ac1a0cf59eb72ed78146ef89aafa1182"
    },
    {
     "role": "config",
     "path": "config.json",
     "url": "https://huggingface.co/spdf-format/valen-0.8b-onnx/resolve/main/config.json",
     "bytes": 3333,
     "sha256": "8a6a766acfe35a6eb3d373e90c43af0f08dbd44301251df71e18b1b5b5381c08"
    }
   ],
   "modalities": [
    "text"
   ],
   "platforms": [
    "macos",
    "windows",
    "linux"
   ],
   "min_memory_mb": 2500,
   "space_version": null,
   "judge_calibration": {
    "choice": {
     "temperature": 1,
     "prior_correction": false
    },
    "noul": {
     "temperature": 1,
     "prior_correction": false
    }
   },
   "notes": "Exportación propia de Valen-Team/Valen-0.8B (rev. 4c858f2e) sobre el grafo de onnx-community/Qwen3.5-0.8B-ONNX; sin publicar todavía: constrúyela con models/valen y regístrala con ModelManager::import_local.",
   "published": false,
   "dtype": "int8"
  },
  {
   "id": "valen-0.8b-onnx-static1024-q4",
   "name": "Valen 0.8B · ONNX q4 estático (1024 tokens, WebGPU)",
   "family": "valen-0.8b",
   "kind": "judge",
   "kinds": [
    "judge"
   ],
   "engine": "onnxruntime-web",
   "format": "onnx",
   "license": "Apache-2.0",
   "license_url": "https://www.apache.org/licenses/LICENSE-2.0",
   "source": "https://huggingface.co/spdf-format/valen-0.8b-onnx",
   "revision": "main",
   "bytes": 531477176,
   "files": [
    {
     "role": "onnx",
     "path": "valen_backbone_static1024_q4.onnx",
     "url": "https://huggingface.co/spdf-format/valen-0.8b-onnx/resolve/main/valen_backbone_static1024_q4.onnx",
     "bytes": 30669581,
     "sha256": "d23f71b38194d72f1592bc8137473425c420f11a5de528b7cb11b38412da4cda"
    },
    {
     "role": "onnx_data",
     "path": "valen_backbone_static1024_q4.onnx.data",
     "url": "https://huggingface.co/spdf-format/valen-0.8b-onnx/resolve/main/valen_backbone_static1024_q4.onnx.data",
     "bytes": 475521024,
     "sha256": "ce0b92017c3c7ba99493f6db6d3e54aedce9795436b7a09df6799eaa0f37319d"
    },
    {
     "role": "head",
     "path": "valen_head.onnx",
     "url": "https://huggingface.co/spdf-format/valen-0.8b-onnx/resolve/main/valen_head.onnx",
     "bytes": 5292756,
     "sha256": "e7624dd82b1c674229c4b336df6ce04c5b1dd85cade9dde04186c0a40c8b1df1"
    },
    {
     "role": "tokenizer",
     "path": "tokenizer.json",
     "url": "https://huggingface.co/spdf-format/valen-0.8b-onnx/resolve/main/tokenizer.json",
     "bytes": 19989343,
     "sha256": "87a7830d63fcf43bf241c3c5242e96e62dd3fdc29224ca26fed8ea333db72de4"
    },
    {
     "role": "tokenizer_config",
     "path": "tokenizer_config.json",
     "url": "https://huggingface.co/spdf-format/valen-0.8b-onnx/resolve/main/tokenizer_config.json",
     "bytes": 1139,
     "sha256": "e98f1901ac6f0adff67b1d540bfa0c36ac1a0cf59eb72ed78146ef89aafa1182"
    },
    {
     "role": "config",
     "path": "config.json",
     "url": "https://huggingface.co/spdf-format/valen-0.8b-onnx/resolve/main/config.json",
     "bytes": 3333,
     "sha256": "8a6a766acfe35a6eb3d373e90c43af0f08dbd44301251df71e18b1b5b5381c08"
    }
   ],
   "modalities": [
    "text"
   ],
   "platforms": [
    "web"
   ],
   "min_memory_mb": 3000,
   "space_version": null,
   "judge_calibration": {
    "choice": {
     "temperature": 1,
     "prior_correction": false
    },
    "noul": {
     "temperature": 1,
     "prior_correction": false
    }
   },
   "notes": "Exportación propia de Valen-Team/Valen-0.8B (rev. 4c858f2e) sobre el grafo de onnx-community/Qwen3.5-0.8B-ONNX; sin publicar todavía: constrúyela con models/valen y regístrala con ModelManager::import_local.",
   "published": false,
   "dtype": "static1024_q4"
  }
 ],
 "recommendations": {
  "macos": {
   "embed": [
    "embeddinggemma-2-gguf-q8_0"
   ],
   "generate": [
    "gemma-4-e4b-it-gguf-q4_k_m",
    "gemma-4-e2b-it-gguf-q4_k_m"
   ],
   "judge": [
    "valen-0.8b-onnx-int8",
    "gemma-4-e4b-it-gguf-q4_k_m",
    "gemma-4-e2b-it-gguf-q4_k_m"
   ]
  },
  "windows": {
   "embed": [
    "embeddinggemma-2-gguf-q8_0"
   ],
   "generate": [
    "gemma-4-e4b-it-gguf-q4_k_m",
    "gemma-4-e2b-it-gguf-q4_k_m"
   ],
   "judge": [
    "valen-0.8b-onnx-int8",
    "gemma-4-e4b-it-gguf-q4_k_m",
    "gemma-4-e2b-it-gguf-q4_k_m"
   ]
  },
  "linux": {
   "embed": [
    "embeddinggemma-2-gguf-q8_0"
   ],
   "generate": [
    "gemma-4-e4b-it-gguf-q4_k_m",
    "gemma-4-e2b-it-gguf-q4_k_m"
   ],
   "judge": [
    "valen-0.8b-onnx-int8",
    "gemma-4-e4b-it-gguf-q4_k_m",
    "gemma-4-e2b-it-gguf-q4_k_m"
   ]
  },
  "ios": {
   "embed": [
    "embeddinggemma-2-gguf-q8_0",
    "embeddinggemma-2-gguf-q8_0-text"
   ],
   "generate": [
    "gemma-4-e2b-it-gguf-q4_k_m"
   ],
   "judge": [
    "gemma-4-e2b-it-gguf-q4_k_m"
   ]
  },
  "android": {
   "embed": [
    "embeddinggemma-2-gguf-q8_0",
    "embeddinggemma-2-gguf-q8_0-text"
   ],
   "generate": [
    "gemma-4-e2b-it-gguf-q4_k_m"
   ],
   "judge": [
    "gemma-4-e2b-it-gguf-q4_k_m"
   ]
  },
  "web": {
   "embed": [
    "embeddinggemma-2-onnx-q8",
    "embeddinggemma-2-onnx-q8-text"
   ],
   "generate": [
    "gemma-4-e2b-it-web"
   ],
   "judge": [
    "valen-0.8b-onnx-static1024-q4",
    "gemma-4-e2b-it-onnx-q4f16"
   ]
  }
 }
};

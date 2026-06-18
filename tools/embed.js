/**
 * fata 嵌入生成模块 — Embed
 *
 * 三种模式生成文本嵌入向量，供离线测试工具使用。
 *
 *   bigram       — 快速冒烟测试（纯 JS，<1ms/条，TF-IDF 精度低）
 *   transformers — 保真度验证（与浏览器 bit-identical，需 @xenova/transformers）
 *   python       — 批量参数扫描（sentence-transformers，~2ms/条）
 */

const { wordBigramVector, charBigramVector } = require('./match-core.js');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// ---- Module state ----

let transformersPipeline = null;
let transformersDim = null;
let loadedModel = null; // track which model is loaded

// ---- Main API ----

/**
 * Generate embedding for a single text.
 * @param {string} text
 * @param {string} lang - 'zh' or 'en'
 * @param {string} mode - 'bigram' | 'transformers' | 'python'
 * @returns {Promise<number[]>}
 */
async function generateEmbedding(text, lang, mode) {
  const results = await generateEmbeddings([text], lang, mode);
  return results[0];
}

/**
 * Generate embeddings for multiple texts (batch).
 * @param {string[]} texts
 * @param {string} lang - 'zh' or 'en'
 * @param {string} mode - 'bigram' | 'transformers' | 'python'
 * @returns {Promise<Array<number[]>>}
 */
async function generateEmbeddings(texts, lang, mode) {
  if (mode === 'bigram' || !mode) {
    return texts.map(t => lang === 'en' ? wordBigramVector(t) : charBigramVector(t));
  }
  if (mode === 'transformers') {
    return _embedTransformers(texts, lang);
  }
  if (mode === 'python') {
    return _embedPython(texts, lang);
  }
  throw new Error(`Unknown embed mode: ${mode}. Use bigram, transformers, or python.`);
}

/**
 * Pre-load model for faster subsequent calls.
 * @param {string} mode - 'transformers' | 'python'
 * @param {string} lang - 'zh' or 'en'
 */
async function initEmbedMode(mode, lang) {
  if (mode === 'transformers') {
    await _loadTransformers(lang);
  }
  if (mode === 'python') {
    await _checkPython();
  }
}

// ---- Mode: Transformers.js (bit-identical to browser) ----

async function _loadTransformers(lang) {
  const modelName = lang === 'en' ? 'Xenova/bge-small-en-v1.5' : 'Xenova/bge-small-zh-v1.5';
  if (transformersPipeline && loadedModel === modelName) return;

  try {
    const { pipeline, env } = await import('@xenova/transformers');
    env.allowLocalModels = false;
    env.remoteHost = 'https://huggingface.co';

    transformersPipeline = await pipeline('feature-extraction', modelName, {
      pooling: 'mean',
      normalize: true
    });
    transformersDim = lang === 'en' ? 384 : 512;
    loadedModel = modelName;
    console.error(`[embed] Transformers.js loaded: ${modelName} (${transformersDim}d)`);
  } catch (e) {
    throw new Error(
      `Transformers.js initialization failed: ${e.message}\n` +
      `  Install with: npm install @xenova/transformers\n` +
      `  Then try again.`
    );
  }
}

async function _embedTransformers(texts, lang) {
  await _loadTransformers(lang);
  const results = [];
  for (const text of texts) {
    const output = await transformersPipeline(text, {
      pooling: 'mean',
      normalize: true
    });
    results.push(Array.from(output.data));
  }
  return results;
}

// ---- Mode: Python sentence-transformers (faster, ~equivalent quality) ----

let _pythonAvailable = null;

async function _checkPython() {
  if (_pythonAvailable !== null) return;
  return new Promise((resolve) => {
    const p = spawn('python3', ['-c', 'import sentence_transformers; print("ok")'], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    p.stdout.on('data', d => stdout += d.toString());
    p.on('close', code => {
      _pythonAvailable = code === 0 && stdout.includes('ok');
      if (!_pythonAvailable) {
        console.error('[embed] Python sentence-transformers not available. Install: pip install sentence-transformers');
      }
      resolve();
    });
  });
}

async function _embedPython(texts, lang) {
  await _checkPython();
  if (!_pythonAvailable) throw new Error('Python sentence-transformers not available');

  const modelName = lang === 'en'
    ? 'BAAI/bge-small-en-v1.5'
    : 'BAAI/bge-small-zh-v1.5';

  const script = `
import json, sys
from sentence_transformers import SentenceTransformer
model = SentenceTransformer(${JSON.stringify(modelName)})
input_data = json.load(sys.stdin)
texts = input_data['texts']
embeddings = model.encode(texts, normalize_embeddings=True).tolist()
print(json.dumps({'embeddings': embeddings}))
`;

  return new Promise((resolve, reject) => {
    const p = spawn('python3', ['-c', script], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    p.stdout.on('data', d => stdout += d.toString());
    p.stderr.on('data', d => stderr += d.toString());

    p.on('close', code => {
      if (code !== 0) {
        reject(new Error(`Python embedding failed (exit ${code}): ${stderr}`));
        return;
      }
      try {
        const result = JSON.parse(stdout);
        resolve(result.embeddings);
      } catch (e) {
        reject(new Error(`Python output parse failed: ${stdout.slice(0,200)}`));
      }
    });

    p.stdin.write(JSON.stringify({ texts }) + '\n');
    p.stdin.end();
  });
}

// ---- Mode: Bigram (via match-core.js) ----
// Already handled inline in generateEmbeddings()

module.exports = { generateEmbedding, generateEmbeddings, initEmbedMode };

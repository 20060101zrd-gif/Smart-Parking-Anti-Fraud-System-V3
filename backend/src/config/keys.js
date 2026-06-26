// backend/src/config/keys.js
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const env = require('./env');

class KeyManager {
  constructor() {
    this.keysDir = env.KEYS_DIR;
    this.privateKeyPath = path.join(this.keysDir, 'private.pem');
    this.publicKeyPath = path.join(this.keysDir, 'public.pem');
    this.privateKey = null;
    this.publicKey = null;
  }

  loadOrGenerateKeys() {
    // 确保存储目录存在
    if (!fs.existsSync(this.keysDir)) {
      fs.mkdirSync(this.keysDir, { recursive: true });
    }

    // 若本地存在，直接读取
    if (fs.existsSync(this.privateKeyPath) && fs.existsSync(this.publicKeyPath)) {
      this.privateKey = fs.readFileSync(this.privateKeyPath, 'utf8');
      this.publicKey = fs.readFileSync(this.publicKeyPath, 'utf8');
      console.log('✅ [Keys] 成功加载本地 RS256 密钥对');
      return { privateKey: this.privateKey, publicKey: this.publicKey };
    }

    // 若不存在，实时生成 RS256 密钥对
    console.log('⏳ [Keys] 未检测到密钥，正在生成 RS256 密钥对...');
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });

    // 写入本地文件系统
    fs.writeFileSync(this.privateKeyPath, privateKey, 'utf8');
    fs.writeFileSync(this.publicKeyPath, publicKey, 'utf8');
    
    this.privateKey = privateKey;
    this.publicKey = publicKey;
    console.log('✅ [Keys] RS256 密钥对生成并持久化成功');

    return { privateKey, publicKey };
  }
}

module.exports = new KeyManager();
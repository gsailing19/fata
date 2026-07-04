/**
 * fata Chinese Seed Injector (Node.js)
 *
 * Injects 40 Chinese seed texts into the matching pool via Worker API.
 * Uses char-bigram embeddings (matching the Chinese fallback path, 512-dim).
 *
 * Usage: FATA_HMAC_KEY="<key>" node tools/inject-zh-seeds.js
 */

const crypto = require('crypto');
const https = require('https');

const WORKER = process.env.FATA_WORKER_URL || 'https://fata.uk';
const HMAC_KEY = process.env.FATA_HMAC_KEY || '';

const SEEDS = [
  // 孤独/被倾听 (5)
  "搬来这个城市半年了，除了同事一个朋友都没交到。周末有时候两天都不出门，也不跟任何人说话。不是不想社交，是真的不知道怎么开始了。",
  "朋友圈里有几百个好友，但半夜睡不着的时候，翻完整个通讯录也找不到一个可以发消息的人。这种热闹里的孤独，比一个人待着还难受。",
  "上周删掉了手机上所有的交友软件。划来划去，没有一个人真的想了解我。大家都只是在打发时间，包括我自己。",
  "我一个人去吃火锅，服务员用同情的眼光看了我一眼。其实我并不觉得一个人吃饭有什么问题，但那个眼神让我难受了一整天。",
  "三十岁了，身边的朋友结婚的结婚、生孩子的生孩子，聚一次越来越难。我不是不想融入他们的生活，是他们的生活里已经没有我的位置了。",

  // 焦虑/迷茫 (5)
  "今年换了三份工作了，每份都做不长久。不是工作不好，是我自己出了问题。我不知道自己在找什么，也不知道找到了就能不能开心。",
  "每天晚上躺下脑子就开始转，越想越多。工作、钱、未来、父母的身体，每一件事都压在心上。明明很困，就是睡不着。",
  "同学群里有人在晒新房、晒新车、晒孩子的照片。我连下个月的房租都在发愁。我知道不该跟别人比，但控制不住地觉得自己很失败。",
  "三十岁了突然不知道自己在干什么。当初选的专业、选的工作、选的城市，好像都不是自己真正想要的。但如果重来，我也不知道该选什么。",
  "最近总是莫名地心慌，心跳加速，手心出汗。去医院查了，身体没问题。医生说可能是焦虑。我不知道自己在焦虑什么，所以才更害怕。",

  // 日常小确幸 (5)
  "今天下班路上看到一只橘猫趴在围墙上晒太阳，我停下来看了五分钟。它懒洋洋地翻了个身，完全不理我。那种无所谓的态度让我很羡慕。",
  "窗台上那盆绿萝又长了两片新叶子。我已经养死过三盆植物了，这是唯一活下来的。每天早上起来第一件事就是看看它，像个老父亲。",
  "今天自己做了顿饭，番茄炒蛋加一碗米饭。虽然卖相一般，但吃的时候突然很想哭——好久没有好好照顾自己了。",
  "下班路过花店，买了一束洋甘菊。店员说花语是'逆境中的坚强'。我只是觉得好看，但这个花语让我在回家的地铁上愣了很久。",
  "今天天气特别好，天空蓝得不真实。我在公司楼下的长椅上坐了十分钟，什么都不想，就看着云飘过去。这十分钟是我这一天最好的部分。",

  // 深度思考 (5)
  "有时候觉得人生就像在一条河上漂流，你不知道下游是什么，也控制不了方向。你能做的只有尽量不翻船。但偶尔也会想，是不是应该主动划桨。",
  "我一直在想一个问题：我们到底是为了工作而生活，还是为了生活在工作？如果明天就死了，我会后悔花了太多时间在那些根本不重要的事情上吗？",
  "最近读了一本书，里面说'人不是生来就完整的，而是通过与他人的连接才变得完整'。我觉得说得对，但又觉得依赖别人让自己变完整，是不是太脆弱了。",
  "小时候以为长大了就什么都懂了。现在才发现，大人们只是在假装知道自己在干什么。每个人都在即兴表演，没有人有剧本。这个发现既让我释然，又让我恐惧。",
  "如果平行宇宙真的存在，另一个世界的我现在在做什么呢？是不是做了更勇敢的选择？是不是过得更开心？或者其实每个世界的我，都在想同样的问题。",

  // 职业困惑 (5)
  "每天都在想辞职，但打开招聘网站看了半天，又默默关掉了。不是没有更好的工作，是我不知道自己还能做什么。这种被困住的感觉，比加班还累。",
  "我做着别人羡慕的工作，拿着不错的薪水，但每天早上起床都需要巨大的勇气。我是不是太矫情了？还是说，这就是成年人该承受的东西？",
  "团队里最年轻的那个人上周辞职了，说要去大理开民宿。大家都在笑，但我知道每个人心里都在羡慕他。包括我自己。",
  "收到了一个 offer，薪资涨了30%，但我犹豫了。不是钱的问题，是我不知道自己还想不想继续做这一行。这种感觉说出来，别人会觉得我不知足吧。",
  "面试的时候 HR 问我'五年规划是什么'，我编了一个听起来很有野心的答案。其实我连下周想干什么都不知道。三十岁的人说这种话是不是很丢人？",

  // 关系/情感觉察 (5)
  "分手四个月了，还是会梦到他。梦里的场景越来越模糊，但醒来后的失落感一点没变。这到底什么时候才能过去。",
  "今天在街上看到一个背影很像她的人，心跳漏了一拍。不是她。但我站在原地愣了好一会儿，不知道自己在等什么。",
  "我发现我在每段关系里都在扮演对方想要的样子。懂事、体贴、不麻烦人。时间久了，我连自己原本是什么样子都忘了。",
  "不是不想谈恋爱，是害怕。害怕又是重复同样的模式——刚开始很美好，然后慢慢变淡，最后不欢而散。我禁不起再来一次了。",
  "妈妈说'你也该找个人了'。她知道我不是不想找，但她不知道我为什么找不到。我自己也不知道。可能是要求太高，可能是运气太差，可能是我自己的问题。",

  // 成长感悟 (5)
  "今天拒绝了一个不合理的要求。以前的我肯定会勉强答应，然后自己生闷气。说不出为什么，就是突然不想委屈自己了。这算是成长吗？",
  "最近开始接受自己的不完美了。不是那种嘴上说接受心里还在较劲，是真的觉得有些事做不好也没关系。这个变化花了三十年。",
  "以前总觉得要对所有人好，要让所有人都满意。后来发现，你对别人越好，别人越不把你当回事。善良是需要边界的，这个道理我学得太晚了。",
  "坚持健身三个月了，体重没怎么变，但心态变了很多。不是每件事都要立刻看到结果。有些改变是无声的，像树在长根，你看不见，但它确实在发生。",
  "我有一个'不开心基金'——每次心情不好就往里面转一百块钱。一年下来攒了差不多两万块。今天用这笔钱给自己报了一个陶艺班。这可能是我做过最健康的事了。",

  // 创意/创作渴望 (5)
  "想学吉他想了五年了，每次都说'等忙完这段'。今天路过琴行，进去摸了一下。店员问我要不要试课，我说再看看。走出门就后悔了。",
  "我有一个文件夹叫'总有一天要写的故事'，里面有二十几个开头，没有一篇写完的。我不是没有才华，我是太害怕它们不够好。",
  "小时候很喜欢画画，课本上空白的地方全是我的涂鸦。后来不知道怎么就放弃了。上周买了盒彩铅，画了一只很丑的猫。它很丑，但我很开心。",
  "看到别人拍 vlog 记录生活，觉得真好。我也想过，但总是觉得自己生活太普通了，没什么好拍的。可是普通的日子，是不是也值得被记住？",
  "最近开始用手机拍天空。每天一张，已经坚持了四十七天。翻回去看，每张都不一样，有的蓝、有的粉、有的灰。生活大概也是这样，没什么了不起，但都值得记录。"
];

// Chinese char-bigram embedding (512-dim, matching match-engine.js _charBigramVector)
function charBigramVector(text) {
  const clean = (text || '').replace(/\s+/g, '');
  if (clean.length < 2) return new Array(512).fill(0);
  const bigrams = {};
  for (let i = 0; i < clean.length - 1; i++) {
    const bg = clean[i] + clean[i + 1];
    bigrams[bg] = (bigrams[bg] || 0) + 1;
  }
  const total = Math.sqrt(Object.values(bigrams).reduce((sum, v) => sum + v * v, 0));
  if (total === 0) return new Array(512).fill(0);
  const dim = 512;
  const vector = new Array(dim).fill(0);
  for (const [bg, count] of Object.entries(bigrams)) {
    let hash = 0;
    for (let i = 0; i < bg.length; i++) {
      hash = ((hash << 5) - hash) + bg.charCodeAt(i);
      hash |= 0;
    }
    vector[Math.abs(hash) % dim] += count / total;
  }
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  return norm > 0 ? vector.map(v => v / norm) : vector;
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function hmacSign(endpoint) {
  const timestamp = Date.now().toString();
  const payload = timestamp + ':' + endpoint;
  const signature = crypto.createHmac('sha256', HMAC_KEY).update(payload).digest('hex');
  return { 'X-Fata-Signature': signature, 'X-Fata-Timestamp': timestamp };
}

function fetchJSON(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = https.request(urlObj, { method: options.method || 'GET', headers: options.headers || {}, timeout: 30000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function injectSeeds() {
  if (!HMAC_KEY || HMAC_KEY.length < 16) {
    console.error('FATA_HMAC_KEY environment variable required (min 16 chars)');
    process.exit(1);
  }

  console.log(`准备注入 ${SEEDS.length} 条中文种子...\n`);

  let success = 0, failed = 0;

  for (let i = 0; i < SEEDS.length; i++) {
    const text = SEEDS[i];
    const embedding = charBigramVector(text);
    const snippet = text.slice(0, 80);

    const body = JSON.stringify({
      title: `[Seed ZH] ${snippet}`,
      body: JSON.stringify({
        _kv: 4,
        l: 'zh',
        et: 'tfidf',
        emb_dim: 512,
        text_snippet: snippet
      }),
      labels: ['seed', 'pending']
    });

    const endpoint = '/api/github/issues';
    const headers = {
      'Content-Type': 'application/json',
      ...hmacSign(endpoint)
    };

    try {
      const resp = await fetchJSON(`${WORKER}${endpoint}`, {
        method: 'POST', headers, body
      });
      if (resp.status === 201 || resp.status === 200) {
        console.log(`  [${i + 1}/${SEEDS.length}] ✓ #${resp.data.number} → "${snippet.slice(0, 40)}..."`);
        success++;
      } else {
        console.log(`  [${i + 1}/${SEEDS.length}] ✗ ${resp.status}: ${JSON.stringify(resp.data).slice(0, 100)}`);
        failed++;
      }
    } catch (e) {
      console.log(`  [${i + 1}/${SEEDS.length}] ✗ ${e.message}`);
      failed++;
    }

    // Rate limit: GitHub API 30/min
    await new Promise(r => setTimeout(r, 2500));
  }

  console.log(`\n注入完成: ${success} 成功, ${failed} 失败`);
}

injectSeeds().catch(e => { console.error(e); process.exit(1); });

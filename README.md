# NCE III Listening Lab

新概念英语第三册美音逐句精听工具。项目为原生 HTML、CSS、JavaScript 实现，无后端、无构建依赖，可直接部署至 GitHub Pages。

## 功能

- 60 课、1724 句双语字幕
- 英文、中文、中英双语三种字幕模式
- 点击句子定位播放，当前句高亮并自动跟随
- 顺序、单课循环、单句循环三种播放模式
- 0.75x 至 2x 倍速，支持上/下一句和上/下一课
- 本地保存学习进度、完成状态与播放器偏好
- 桌面和移动端响应式布局

## 播放器与资源分离

播放器只读取 [`data/catalog.json`](data/catalog.json) 中的课程索引，不内嵌音频或字幕：

```json
{
  "resources": {
    "lyrics": "https://cdn.jsdelivr.net/gh/magang0425/NCE@master/NCE3",
    "audio": "https://cdn.jsdelivr.net/gh/tangx/New-Concept-English@main/...",
    "audioFallback": "https://nce.mleo.site/NCE3"
  },
  "units": [
    {
      "num": 1,
      "title": "A Puma at Large",
      "file": "01－A Puma at Large",
      "lineCount": 24
    }
  ]
}
```

打开课程时，播放器按需从 jsDelivr 加载 `${file}.lrc` 和 `${file}.mp3`。如果主音频 CDN 不可用，会自动切换备用音频源并继续播放。LRC 使用 `[mm:ss.xx]English | 中文` 格式。

重新生成并校验目录：

```bash
python3 scripts/build_data.py
```

## 本地运行

```bash
python3 -m http.server 8000
```

访问 `http://127.0.0.1:8000/`。

## GitHub Pages

仓库包含 `.github/workflows/pages.yml`。推送到 `main` 后，在仓库 Settings > Pages 中将 Source 设为 **GitHub Actions**，工作流会发布当前静态目录。

## 资源说明

- 双语 LRC：[magang0425/NCE](https://github.com/magang0425/NCE)
- 美音 MP3：[tangx/New-Concept-English](https://github.com/tangx/New-Concept-English)
- CDN：[jsDelivr](https://www.jsdelivr.com/)

课文与音频版权归原出版方所有，本项目仅供个人学习与研究使用。

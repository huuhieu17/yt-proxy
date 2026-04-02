# Youtube Music Stream

Backend service để search và extract audio URL từ YouTube

## 📡 API Endpoints

### GET /
Health check

### GET /recommends?videoId={id}&limit={number}
Lấy danh sách video/bài hát tiếp theo dựa trên video hiện tại

**Parameters:**
- `videoId` (optional): YouTube video ID (11 ký tự)
- `url` (optional): YouTube URL thay cho `videoId`
- `limit` (optional): Số lượng kết quả muốn lấy (mặc định 10, tối đa 50)

> Cần truyền `videoId` hoặc `url`

**Response:**
```json
{
  "success": true,
  "sourceVideoId": "dQw4w9WgXcQ",
  "count": 3,
  "songs": [
    {
      "id": "kxopViU98Xo",
      "title": "Never Gonna Give You Up",
      "channel": "Rick Astley",
      "url": "https://www.youtube.com/watch?v=kxopViU98Xo"
    }
  ]
}
```

### GET /search?q={query}
Search YouTube và trả về audio stream URL

**Parameters:**
- `q` (required): Tên bài hát hoặc query search
- `format` (optional): `worstaudio` (default), `bestaudio`

**Response:**
```json
{
  "success": true,
  "title": "Song Title",
  "url": "https://...",
  "format": "audio/mp4",
  "source": "youtube",
  "quality": "worstaudio"
}
```

## 🧪 Test Local

```bash
npm install
npm start

# Test
curl "http://localhost:3000/recommends?videoId=dQw4w9WgXcQ&limit=5"
curl "http://localhost:3000/recommends?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ&limit=5"
curl "http://localhost:3000/search?q=son+tung+mtp"
```

## 📝 Môi trường

- Node.js 18+
- yt-dlp (bundled via npm package `yt-dlp-exec`, no global install required)
- ffmpeg (bundled via npm package `ffmpeg-static`, no global install required)
- Express.js

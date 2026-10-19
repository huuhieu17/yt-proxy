# Youtube Music Stream

Backend service để search và extract audio URL từ YouTube và SoundCloud.

## 📡 API Endpoints

### GET /
Health check

### GET /info?videoId={id}
Lấy thông tin chi tiết của video YouTube.

**Parameters:**
- `videoId` (optional): YouTube video ID (11 ký tự)
- `url` (optional): YouTube URL thay cho `videoId`

**Response:**
```json
{
  "success": true,
  "info": {
    "id": "dQw4w9WgXcQ",
    "title": "Video title",
    "duration": 212,
    "uploader": "Channel name"
  }
}
```

## YouTube routes

Các route YouTube mới có prefix `/youtube`. Các route cũ như `/play`, `/info`, `/search`, `/stream/mp3` và `/recommends` vẫn được giữ để tương thích.

### GET /youtube/play?videoId={id}&bitrate=192k
Trả về URL stream MP3 của YouTube.

### GET /youtube/search?q={query}&limit={number}
Tìm bài hát trên YouTube.

## SoundCloud routes

SoundCloud dùng URL track đầy đủ và được tách riêng dưới prefix `/soundcloud`.

### GET /soundcloud/search?q={query}&limit={number}
Tìm track trên SoundCloud.

### GET /soundcloud/info?url={trackUrl}
Trả về metadata của track SoundCloud.

### GET /soundcloud/play?url={trackUrl}&bitrate=192k
Trả về URL stream MP3 của track SoundCloud.

Ví dụ:
```text
/soundcloud/search?q=lofi&limit=5
/soundcloud/info?url=https%3A%2F%2Fsoundcloud.com%2Fartist%2Ftrack
/soundcloud/play?url=https%3A%2F%2Fsoundcloud.com%2Fartist%2Ftrack&bitrate=192k
```

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
curl "http://localhost:3000/soundcloud/search?q=lofi&limit=5"
```

## 📝 Môi trường

- Node.js 18+
- yt-dlp (bundled via npm package `yt-dlp-exec`, no global install required)
- ffmpeg (bundled via npm package `ffmpeg-static`, no global install required)
- Express.js

## GitHub Actions - Docker Hub

Workflow `.github/workflows/docker-publish.yml` sẽ tự động build và push image lên Docker Hub khi push vào branch `main` hoặc `master`, và khi tạo tag dạng `v1.0.0`.

Tạo các GitHub repository secrets sau:

- `DOCKERHUB_USERNAME`: Docker Hub username
- `DOCKERHUB_TOKEN`: Docker Hub access token, không dùng password tài khoản

Image được publish theo dạng:

```text
<DOCKERHUB_USERNAME>/steve-music-api:latest
<DOCKERHUB_USERNAME>/steve-music-api:sha-<commit>
```

Trên Synology có thể pull image đã build:

```bash
docker pull <DOCKERHUB_USERNAME>/steve-music-api:latest
docker compose up -d
```

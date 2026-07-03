Enterimport express from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';

const app = express();
app.use(express.json());

// الرأس الافتراضي (Headers) لمحاكاة المتصفح ومنع الحظر
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'ar,en-US;q=0.7,en;q=0.3',
    'Referer': 'https://ak.sv/'
};

// 1. رابط البحث: /search?q=اسم الفيلم
app.get('/search', async (req, res) => {
    const query = req.query.q;
    if (!query) return res.status(400).json({ error: 'Please provide a search query (?q=...)' });

    try {
        const searchUrl = `https://ak.sv/search?q=${encodeURIComponent(query)}`;
        const { data } = await axios.get(searchUrl, { headers: HEADERS, timeout: 15000 });
        const $ = cheerio.load(data);
        const movies = [];

        $('div.entry-box').each((index, element) => {
            const container = $(element);
            const titleElem = container.find('h3.entry-title');
            if (!titleElem.length) return;

            const title = titleElem.text().trim();
            let movieUrl = titleElem.find('a').attr('href') || '';
            if (movieUrl.startsWith('/')) {
                movieUrl = 'https://ak.sv' + movieUrl;
            }

            // تخطي المسلسلات والبرامج للحصول على الأفلام فقط بحال كود بايثون
            if (movieUrl.includes('/series/') || movieUrl.includes('/shows/')) return;

            const imgElem = container.find('img.lazy');
            let imgUrl = imgElem.attr('data-src') || imgElem.attr('src') || '';

            const rating = container.find('span.rating').text().replace('★', '').trim() || 'N/A';
            const quality = container.find('span.quality').text().trim() || 'غير محدد';

            let year = '';
            const genres = [];
            container.find('span.badge').each((i, badge) => {
                const text = $(badge).text().trim();
                if (/^\d{4}$/.test(text)) {
                    year = text;
                } else if (text !== 'مشاهدة' && text !== 'قائمتي') {
                    genres.push(text);
                }
            });

            movies.push({ title, url: movieUrl, image: imgUrl, rating, quality, year, genres });
        });

        res.json({ success: true, results: movies });
    } catch (error) {
        res.status(500).json({ error: 'Search failed', details: error.message });
    }
});

// 2. رابط جلب الروابط المباشرة: /download?url=رابط الفيلم من أكوام
app.get('/download', async (req, res) => {
    const movieUrl = req.query.url;
    if (!movieUrl) return res.status(400).json({ error: 'Please provide a movie url (?url=...)' });

    try {
        // الخطوة 1: ندخلو لصفحة الفيلم ونجيبو روابط الجودات (go.ak.sv)
        const response1 = await axios.get(movieUrl, { headers: HEADERS, timeout: 15000 });
        let $ = cheerio.load(response1.data);
        const qualities = {};

        $('div.tab-content.quality').each((index, element) => {
            const tab = $(element);
            const tabId = tab.attr('id') || '';
            let qualityName = '';

            if (tabId === 'tab-5') qualityName = '1080p';
            else if (tabId === 'tab-4') qualityName = '720p';
            else if (tabId === 'tab-3') qualityName = '480p';
            else return;

            const downloadLink = tab.find('a.link-download').attr('href');
            if (downloadLink) {
                qualities[qualityName] = downloadLink;
            }
        });

        // الخطوة 2: نفكّو شفرة الروابط (Resolve) باش نرجعو الرابط المباشر النهائي لكل جودة
        const finalLinks = {};
        for (const [quality, goLink] of Object.entries(qualities)) {
            try {
                // نطلبو رابط go.ak.sv مع منع التوجيه التلقائي بحال بايثون
                const resp = await axios.get(goLink, { 
                    headers: HEADERS, 
                    maxRedirects: 0, 
                    validateStatus: (status) => status >= 200 && status < 400 
                });

                let downloadPageLink = resp.headers.location;

                // يلا ما دارش Redirect تلقائي، نقلبو عليه وسط الـ HTML
                if (!downloadPageLink) {
                    const $go = cheerio.load(resp.data);
                    $go('a').each((i, a) => {
                        const href = $go(a).attr('href') || '';
                        if (href.includes('/download/') && href.startsWith('https://ak.sv/download/')) {
                            downloadPageLink = href;
                        }
                    });
                }

                // دابا ندخلو لصفحة التحميل النهائية ونقشرو الرابط المباشر (downet.net)
                if (downloadPageLink) {
                    const respFinal = await axios.get(downloadPageLink, { headers: HEADERS, timeout: 15000 });
                    const $final = cheerio.load(respFinal.data);
                    let directUrl = '';

                    // طريقة 1: زر التحميل الرئيسي
                    directUrl = $final('a.link.btn.btn-light').attr('href') || '';

                    // طريقة 2: الرابط النصي الأسفل
                    if (!directUrl) {
                        directUrl = $final('a.font-size-16.text-muted').attr('href') || '';
                    }

                    // طريقة 3: البحث عن downet.net
                    if (!directUrl) {
                        $final('a').each((i, a) => {
                            const href = $final(a).attr('href') || '';
                            if (href.includes('downet.net') && href.endsWith('.mp4')) {
                                directUrl = href;
                            }
                        });
                    }

                    if (directUrl) {
                        finalLinks[quality] = directUrl;
                    }
                }
            } catch (err) {
                finalLinks[quality] = `Error resolving link: ${err.message}`;
            }
        }

        res.json({ success: true, movie_url: movieUrl, download_links: finalLinks });

    } catch (error) {
        res.status(500).json({ error: 'Failed to extract download links', details: error.message });
    }
});

// تصدير التطبيق لـ Vercel
export default app;

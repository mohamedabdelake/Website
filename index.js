import express from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';

const app = express();
app.use(express.json());

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'ar,en-US;q=0.7,en;q=0.3',
    'Referer': 'https://ak.sv/'
};

// 1. رابط البحث: غيرجع ليك لستة ديال الأفلام في JSON مبسط
app.get('/search', async (req, res) => {
    const query = req.query.q;
    if (!query) return res.status(400).json({ error: 'Missing search query (?q=...)' });

    try {
        const searchUrl = `https://ak.sv/search?q=${encodeURIComponent(query)}`;
        const { data } = await axios.get(searchUrl, { headers: HEADERS, timeout: 15000 });
        const $ = cheerio.load(data);
        const movies = [];

        $('div.entry-box').each((index, element) => {
            const container = $(element);
            const titleElem = container.find('h3.entry-title');
            if (!titleElem.length) return;

            const movieUrl = titleElem.find('a').attr('href') || '';
            if (movieUrl.includes('/series/') || movieUrl.includes('/shows/')) return; // تخطي المسلسلات

            const title = titleElem.text().trim();
            const imgUrl = container.find('img.lazy').attr('data-src') || container.find('img').attr('src') || '';
            const rating = container.find('span.rating').text().replace('★', '').trim() || 'N/A';
            const quality = container.find('span.quality').text().trim() || 'N/A';

            let year = '';
            container.find('span.badge').each((i, badge) => {
                const text = $(badge).text().trim();
                if (/^\d{4}$/.test(text)) year = text;
            });

            movies.push({
                title,
                year,
                rating,
                quality,
                image: imgUrl,
                url: movieUrl.startsWith('/') ? 'https://ak.sv' + movieUrl : movieUrl
            });
        });

        // هنا كترجع النتيجة JSON نيشان
        res.json(movies);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 2. رابط روابط التحميل: غيرجع ليك الجودات والروابط المباشرة ديالهم ديريكت في JSON
app.get('/download', async (req, res) => {
    const movieUrl = req.query.url;
    if (!movieUrl) return res.status(400).json({ error: 'Missing movie url (?url=...)' });

    try {
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
            if (downloadLink) qualities[qualityName] = downloadLink;
        });

        const directLinks = {};
        for (const [quality, goLink] of Object.entries(qualities)) {
            try {
                const resp = await axios.get(goLink, { 
                    headers: HEADERS, 
                    maxRedirects: 0, 
                    validateStatus: (status) => status >= 200 && status < 400 
                });

                let downloadPageLink = resp.headers.location;
                if (!downloadPageLink) {
                    const $go = cheerio.load(resp.data);
                    $go('a').each((i, a) => {
                        const href = $go(a).attr('href') || '';
                        if (href.includes('/download/')) downloadPageLink = href;
                    });
                }

                if (downloadPageLink) {
                    const respFinal = await axios.get(downloadPageLink, { headers: HEADERS, timeout: 15000 });
                    const $final = cheerio.load(respFinal.data);
                    let directUrl = $final('a.link.btn.btn-light').attr('href') || $final('a.font-size-16.text-muted').attr('href') || '';

                    if (!directUrl) {
                        $final('a').each((i, a) => {
                            const href = $final(a).attr('href') || '';
                            if (href.includes('downet.net') && href.endsWith('.mp4')) directUrl = href;
                        });
                    }

                    if (directUrl) directLinks[quality] = directUrl;
                }
            } catch (err) {
                // تخطي الأخطاء لكل جودة منفصلة لضمان استمرار السكراب
            }
        }

        // كيرجع ليك JSON فيه غا الجودات والروابط المباشرة ديالهم
        res.json(directLinks);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export default app;

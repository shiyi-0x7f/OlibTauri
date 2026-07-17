// -------- Constants matching Python backend (constants.py) --------
export const LANGUAGES: Record<string, string | null> = {
    '所有语言': null, '中文': 'chinese', '繁体': 'traditional chinese', '英语': 'english',
    '俄语': 'russian', '德语': 'german', '西班牙语': 'spanish', '法语': 'french',
    '日语': 'japanese', '韩语': 'korean', '意大利语': 'italian', '葡萄牙语': 'portuguese',
    '荷兰语': 'dutch', '波兰语': 'polish', '乌克兰语': 'ukrainian', '土耳其语': 'turkish',
    '阿拉伯语': 'arabic', '瑞典语': 'swedish', '匈牙利语': 'hungarian', '捷克语': 'czech',
    '印地语': 'hindi', '越南语': 'vietnamese', '泰语': 'thai', '印度尼西亚语': 'indonesian',
    '丹麦语': 'danish', '挪威语': 'norwegian', '芬兰语': 'finnish', '希腊语': 'greek',
    '罗马尼亚语': 'romanian', '波斯语': 'persian', '希伯来语': 'hebrew',
};

export const SEARCHMODE: Record<string, string | null> = {
    '默认搜索顺序': null, '热度': 'popular', '匹配度': 'bestmatch',
    '名称': 'title', '上传日期': 'date', '出版日期': 'year',
};

export const EXTENSIONS: Record<string, string | null> = {
    '所有格式': null, 'txt': 'txt', 'pdf': 'pdf', 'epub': 'epub',
    'mobi': 'mobi', 'azw': 'azw', 'azw3': 'azw3',
};

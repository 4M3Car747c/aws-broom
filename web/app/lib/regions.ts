// Static knowledge about AWS regions: display names and map coordinates.
// Which regions are *enabled* for the connected account comes from the API.

export interface RegionMeta {
  lng: number;
  lat: number;
  en: string;
  zh: string;
  group: string;
}

export const REGIONS: Record<string, RegionMeta> = {
  "us-east-1": { lng: -77.45, lat: 38.95, en: "N. Virginia", zh: "弗吉尼亚北部", group: "americas" },
  "us-east-2": { lng: -82.99, lat: 39.96, en: "Ohio", zh: "俄亥俄", group: "americas" },
  "us-west-1": { lng: -121.9, lat: 37.35, en: "N. California", zh: "加利福尼亚北部", group: "americas" },
  "us-west-2": { lng: -122.8, lat: 45.6, en: "Oregon", zh: "俄勒冈", group: "americas" },
  "ca-central-1": { lng: -73.6, lat: 45.5, en: "Canada Central", zh: "加拿大中部", group: "americas" },
  "ca-west-1": { lng: -114.07, lat: 51.05, en: "Calgary", zh: "卡尔加里", group: "americas" },
  "sa-east-1": { lng: -46.63, lat: -23.55, en: "São Paulo", zh: "圣保罗", group: "americas" },
  "mx-central-1": { lng: -100.39, lat: 20.59, en: "Mexico Central", zh: "墨西哥中部", group: "americas" },
  "eu-west-1": { lng: -6.26, lat: 53.35, en: "Ireland", zh: "爱尔兰", group: "europe" },
  "eu-west-2": { lng: -0.13, lat: 51.5, en: "London", zh: "伦敦", group: "europe" },
  "eu-west-3": { lng: 2.35, lat: 48.86, en: "Paris", zh: "巴黎", group: "europe" },
  "eu-central-1": { lng: 8.68, lat: 50.11, en: "Frankfurt", zh: "法兰克福", group: "europe" },
  "eu-central-2": { lng: 8.54, lat: 47.37, en: "Zurich", zh: "苏黎世", group: "europe" },
  "eu-north-1": { lng: 18.07, lat: 59.33, en: "Stockholm", zh: "斯德哥尔摩", group: "europe" },
  "eu-south-1": { lng: 9.19, lat: 45.46, en: "Milan", zh: "米兰", group: "europe" },
  "eu-south-2": { lng: -0.88, lat: 41.65, en: "Spain", zh: "西班牙", group: "europe" },
  "ap-east-1": { lng: 114.17, lat: 22.32, en: "Hong Kong", zh: "香港", group: "asia-pacific" },
  "ap-east-2": { lng: 121.56, lat: 25.03, en: "Taipei", zh: "台北", group: "asia-pacific" },
  "ap-northeast-1": { lng: 139.69, lat: 35.69, en: "Tokyo", zh: "东京", group: "asia-pacific" },
  "ap-northeast-2": { lng: 126.98, lat: 37.57, en: "Seoul", zh: "首尔", group: "asia-pacific" },
  "ap-northeast-3": { lng: 135.5, lat: 34.69, en: "Osaka", zh: "大阪", group: "asia-pacific" },
  "ap-southeast-1": { lng: 103.82, lat: 1.35, en: "Singapore", zh: "新加坡", group: "asia-pacific" },
  "ap-southeast-2": { lng: 151.21, lat: -33.87, en: "Sydney", zh: "悉尼", group: "asia-pacific" },
  "ap-southeast-3": { lng: 106.85, lat: -6.21, en: "Jakarta", zh: "雅加达", group: "asia-pacific" },
  "ap-southeast-4": { lng: 144.96, lat: -37.81, en: "Melbourne", zh: "墨尔本", group: "asia-pacific" },
  "ap-southeast-5": { lng: 101.69, lat: 3.14, en: "Malaysia", zh: "马来西亚", group: "asia-pacific" },
  "ap-southeast-6": { lng: 174.76, lat: -36.85, en: "New Zealand", zh: "新西兰", group: "asia-pacific" },
  "ap-southeast-7": { lng: 100.5, lat: 13.75, en: "Thailand", zh: "泰国", group: "asia-pacific" },
  "ap-south-1": { lng: 72.88, lat: 19.08, en: "Mumbai", zh: "孟买", group: "asia-pacific" },
  "ap-south-2": { lng: 78.49, lat: 17.39, en: "Hyderabad", zh: "海得拉巴", group: "asia-pacific" },
  "me-south-1": { lng: 50.58, lat: 26.23, en: "Bahrain", zh: "巴林", group: "middle-east-africa" },
  "me-central-1": { lng: 54.37, lat: 24.45, en: "UAE", zh: "阿联酋", group: "middle-east-africa" },
  "il-central-1": { lng: 34.78, lat: 32.08, en: "Tel Aviv", zh: "特拉维夫", group: "middle-east-africa" },
  "af-south-1": { lng: 18.42, lat: -33.93, en: "Cape Town", zh: "开普敦", group: "middle-east-africa" },
  "cn-north-1": { lng: 116.4, lat: 39.9, en: "Beijing", zh: "北京", group: "china" },
  "cn-northwest-1": { lng: 106.27, lat: 38.47, en: "Ningxia", zh: "宁夏", group: "china" },
  "us-gov-east-1": { lng: -83.0, lat: 40.0, en: "GovCloud East", zh: "GovCloud 东部", group: "gov" },
  "us-gov-west-1": { lng: -121.0, lat: 44.0, en: "GovCloud West", zh: "GovCloud 西部", group: "gov" },
};

export function regionName(code: string, lang: string): string {
  const n = REGIONS[code];
  if (!n) return "";
  return lang.startsWith("zh") ? n.zh : n.en;
}

export const GROUP_ORDER = ["americas", "europe", "asia-pacific", "middle-east-africa", "china", "gov", "other"];

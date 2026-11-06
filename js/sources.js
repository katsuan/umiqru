// うみくる：出どころ（予報のモデル・線の色・警報の種類）と、読む日数などの決まり
// 読まれるところ：app.js と js/ の部品
import { NAMES } from "./names.js";

export const SOURCES = {
  // 波（地球全体を計算する予報。日本の無料の数字の波予報はない）。label は計算の名前（「欧州」のように地域の名前にすると、その地域の予報と思われる）
  // org … 作っている機関、grid … 計算のマス目のおよその細かさ（「それぞれの予報」の欄と出どころに出す）
  ecmwf_wam025:     { label: "WAM", full: "WAM", org: "ECMWF（ヨーロッパ中期予報センター）", grid: "約25km", color: "--s-ecmwf" },
  ncep_gfswave025:  { label: "GFS", full: "GFS-Wave（0.25°）", org: "NOAA（米国海洋大気庁）", grid: "約25km", color: "--s-gfs" },
  meteofrance_wave: { label: "MFWAM", full: "MFWAM", org: "Météo-France（フランス気象局）", grid: "約8km", color: "--s-mf" },
  ncep_gfswave016:  { label: "GFS細", full: "GFS-Wave（0.16°）", org: "NOAA（米国海洋大気庁）", grid: "約16km", color: "--s-gfs16" },
  // 風
  jma_msm:      { label: "MSM", full: "MSM（日本のまわり・約3日半先まで）", org: "気象庁", grid: "約5km", color: "--s-jma" },
  jma_gsm:      { label: "GSM", full: "GSM（世界・7日先まで）", org: "気象庁", grid: "約20km", color: "--s-ecmwf" },
  ecmwf_ifs025: { label: "IFS", full: "IFS", org: "ECMWF（ヨーロッパ中期予報センター）", grid: "約25km", color: "--s-gfs" },
  gfs_seamless: { label: "GFS", full: "GFS", org: "NOAA（米国海洋大気庁）", grid: "約13〜25km", color: "--s-icon" },
  // 潮
  tide736: { label: "潮汐表", full: "海上保安庁の調和定数で計算", color: "--s-tide736" },
  om_sea:  { label: "海面の予報", full: "", color: "--s-omsea" },
};
SOURCES.om_sea.full = `${NAMES.openMeteo} 海面高度（潮＋気圧・風の影響。世界）`;
export const WAVE_MODELS = ["ecmwf_wam025", "ncep_gfswave025", "meteofrance_wave", "ncep_gfswave016"];
export const WIND_MODELS = ["jma_msm", "jma_gsm", "ecmwf_ifs025", "gfs_seamless"];
export const PORT_MAX_KM = 30; // これより遠い港の潮汐表は使わない

// 警報・注意報のうち、海に出るときに見るもの
export const WARN_NAMES = {
  "02": "暴風雪警報", "03": "大雨警報", "05": "暴風警報", "07": "波浪警報", "08": "高潮警報",
  "10": "大雨注意報", "14": "雷注意報", "15": "強風注意報", "16": "波浪注意報", "19": "高潮注意報", "20": "濃霧注意報",
  "32": "暴風雪特別警報", "33": "大雨特別警報", "35": "暴風特別警報", "37": "波浪特別警報", "38": "高潮特別警報",
};

export const DAYS = 7;
export const TZ = "Asia/Tokyo";
export const DEFAULT_PLACE = "城ヶ島";

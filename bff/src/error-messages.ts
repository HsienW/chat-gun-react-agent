export const BFF_ERROR_MESSAGES = {
  upload: {
    rejectedByBff: "圖片上傳未通過 BFF 預檢。",
    tooManyImages: (count: number, max: number) =>
      `圖片附件數量過多：${count} 張，上限為 ${max} 張。`,
    missingImageUrl: (index: number) => `第 ${index} 張圖片缺少 image_url.url。`,
    dataUrlRequired: (index: number) => `第 ${index} 張圖片必須是 base64 data URL。`,
    missingFileName: (index: number) => `第 ${index} 張圖片缺少檔名。`,
    unsupportedExtension: (fileName: string) => `不支援的圖片副檔名：${fileName}。`,
    mimeMismatch: (fileName: string) => `圖片 MIME 類型與副檔名不一致：${fileName}。`,
    metadataMimeMismatch: (fileName: string) =>
      `圖片 metadata MIME 類型與 payload 不一致：${fileName}。`,
    sizeExceeded: (fileName: string) => `圖片超過允許大小：${fileName}。`,
    sizeMetadataMismatch: (fileName: string) =>
      `圖片大小 metadata 與 payload 不一致：${fileName}。`,
    dimensionsTooLarge: (fileName: string) => `圖片尺寸過大：${fileName}。`,
    magicBytesMismatch: (fileName: string) =>
      `圖片檔頭與 MIME 類型不一致：${fileName}。`,
  },
} as const;

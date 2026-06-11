export const FRONTEND_ERROR_MESSAGES = {
  errorEnvelope: {
    source: '來源',
    stage: '階段',
    provider: '服務',
    code: '代碼',
    message: '訊息',
    raw: '原始訊息',
    details: '詳細資料',
    cause: '原因',
  },
  stream: {
    source: 'frontend',
    stage: 'langgraph_stream',
    unknownCode: 'unknown_error',
  },
  imageUpload: {
    dialogTitle: '圖片處理失敗',
    close: '關閉',
    invalidImage: '圖片格式或內容無效。',
    uploadingStatus: {
      queued: '等待處理',
      processing: '處理中',
      completed: '已完成',
      failed: '處理失敗',
    },
    uploadButtonTitle: (maxFiles: number) => `最多可上傳 ${maxFiles} 張圖片`,
    removeImageLabel: (fileName: string) => `移除 ${fileName}`,
    tooManyImages: (maxFiles: number) => `最多只能上傳 ${maxFiles} 張圖片。`,
    remainingSlots: (remainingSlots: number) =>
      `目前只能再新增 ${remainingSlots} 張圖片。`,
    unsupportedExtension: (extension: string) =>
      `不支援的圖片副檔名：${extension || '無副檔名'}。`,
    unsupportedMimeType: (mimeType: string) =>
      `不支援的圖片 MIME 類型：${mimeType || '未知'}。`,
    emptyFile: '圖片檔案是空的。',
    imageTooLarge: (actual: string, max: string) =>
      `圖片檔案過大：${actual}，上限為 ${max}。`,
    processedImageTooLarge: (actual: string, max: string) =>
      `處理後的圖片過大：${actual}，上限為 ${max}。`,
    dimensionsTooLarge: (width: number, height: number) =>
      `圖片尺寸過大：${width}x${height}。`,
    readFailed: '讀取處理後的圖片失敗。',
    encodeFailed: '圖片編碼失敗。',
    contextUnavailable: '瀏覽器無法建立圖片處理環境。',
  },
} as const;

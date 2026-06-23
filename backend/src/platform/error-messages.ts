export const BACKEND_ERROR_MESSAGES = {
  upload: {
    rejectedByBackend:
      "\u5716\u7247\u4e0a\u50b3\u672a\u901a\u904e\u5f8c\u7aef\u5b89\u5168\u6aa2\u67e5\u3002",
    tooManyImages: (count: number, max: number) =>
      `\u6700\u591a\u53ea\u80fd\u4e0a\u50b3 ${max} \u5f35\u5716\u7247\uff0c\u76ee\u524d\u9078\u64c7 ${count} \u5f35\u3002`,
    missingImageUrl: (index: number) =>
      `\u7b2c ${index} \u5f35\u5716\u7247\u7f3a\u5c11 image_url.url\u3002`,
    dataUrlRequired: (index: number) =>
      `\u7b2c ${index} \u5f35\u5716\u7247\u5fc5\u9808\u4f7f\u7528 base64 data URL\u3002`,
    missingFileName: (index: number) =>
      `\u7b2c ${index} \u5f35\u5716\u7247\u7f3a\u5c11\u6a94\u540d\u3002`,
    unsupportedExtension: (fileName: string) =>
      `\u4e0d\u652f\u63f4\u7684\u5716\u7247\u526f\u6a94\u540d\uff1a${fileName}\u3002`,
    mimeMismatch: (fileName: string) =>
      `\u5716\u7247 MIME \u985e\u578b\u8207\u526f\u6a94\u540d\u4e0d\u4e00\u81f4\uff1a${fileName}\u3002`,
    metadataMimeMismatch: (fileName: string) =>
      `\u5716\u7247 metadata MIME \u985e\u578b\u8207 payload \u4e0d\u4e00\u81f4\uff1a${fileName}\u3002`,
    sizeExceeded: (fileName: string) =>
      `\u5716\u7247\u5927\u5c0f\u8d85\u904e\u9650\u5236\uff1a${fileName}\u3002`,
    sizeMetadataMismatch: (fileName: string) =>
      `\u5716\u7247 metadata \u5927\u5c0f\u8207 payload \u4e0d\u4e00\u81f4\uff1a${fileName}\u3002`,
    dimensionsTooLarge: (fileName: string) =>
      `\u5716\u7247\u5c3a\u5bf8\u8d85\u904e\u9650\u5236\uff1a${fileName}\u3002`,
    magicBytesMismatch: (fileName: string) =>
      `\u5716\u7247\u5167\u5bb9\u8207 MIME \u985e\u578b\u4e0d\u4e00\u81f4\uff1a${fileName}\u3002`,
  },
  planner: {
    missingWeatherLocation:
      "\u8acb\u63d0\u4f9b\u8981\u67e5\u8a62\u5929\u6c23\u7684\u57ce\u5e02\u6216\u5730\u5340\u3002",
    missingCalculationExpression:
      "\u8acb\u63d0\u4f9b\u8981\u8a08\u7b97\u7684\u6578\u5b78\u8868\u9054\u5f0f\u3002",
  },
} as const;

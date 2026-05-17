"use client";

import { Upload, App } from "antd";
import type { UploadProps } from "antd";
import { InboxOutlined } from "@ant-design/icons";

const { Dragger } = Upload;

interface FileUploadProps {
  /** API endpoint to get presigned URL */
  presignEndpoint?: string;
  /** Callback when upload completes */
  onComplete?: (key: string, filename: string) => void;
  /** Accepted file types (e.g. ".pdf,.png,.jpg") */
  accept?: string;
  /** Max file size in MB */
  maxSizeMB?: number;
}

export function FileUpload({
  presignEndpoint = "/api/storage/presign",
  onComplete,
  accept,
  maxSizeMB = 50,
}: FileUploadProps) {
  const { message } = App.useApp();

  const uploadProps: UploadProps = {
    name: "file",
    multiple: false,
    accept,
    beforeUpload(file) {
      if (file.size > maxSizeMB * 1024 * 1024) {
        message.error(`File must be smaller than ${maxSizeMB}MB`);
        return Upload.LIST_IGNORE;
      }
      return true;
    },
    async customRequest({ file, onSuccess, onError, onProgress }) {
      try {
        const f = file as File;

        // Get presigned URL
        const params = new URLSearchParams({
          filename: f.name,
          contentType: f.type,
        });
        const res = await fetch(`${presignEndpoint}?${params}`);
        if (!res.ok) throw new Error("Failed to get upload URL");

        const { data } = await res.json();

        // Upload directly to MinIO
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            onProgress?.({ percent: (e.loaded / e.total) * 100 });
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            onSuccess?.(data.key);
            onComplete?.(data.key, f.name);
            message.success(`${f.name} uploaded`);
          } else {
            onError?.(new Error("Upload failed"));
          }
        };
        xhr.onerror = () => onError?.(new Error("Upload failed"));

        xhr.open("PUT", data.url);
        xhr.setRequestHeader("Content-Type", f.type);
        xhr.send(f);
      } catch (err) {
        onError?.(err as Error);
        message.error("Upload failed");
      }
    },
  };

  return (
    <Dragger {...uploadProps}>
      <p className="ant-upload-drag-icon">
        <InboxOutlined />
      </p>
      <p className="ant-upload-text">Click or drag files to upload</p>
    </Dragger>
  );
}

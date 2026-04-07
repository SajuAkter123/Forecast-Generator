import React, { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, FileText, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

import { AnalysisResult, FileData } from '../types';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface FileUploadProps {
  onUpload: (files: FileData[]) => void;
  isLoading: boolean;
  progress?: { current: number, total: number } | null;
  compact?: boolean;
}

export const FileUpload: React.FC<FileUploadProps> = ({ onUpload, isLoading, progress, compact }) => {
  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      const filePromises = acceptedFiles.map(file => {
        return new Promise<FileData>((resolve) => {
          const reader = new FileReader();
          const isPdf = file.type === 'application/pdf';
          
          reader.onload = (e) => {
            const data = e.target?.result as string;
            resolve({
              data,
              mimeType: file.type || (file.name.endsWith('.csv') ? 'text/csv' : 'text/plain')
            });
          };
          
          if (isPdf) {
            reader.readAsDataURL(file);
          } else {
            reader.readAsText(file);
          }
        });
      });

      Promise.all(filePromises).then(files => {
        onUpload(files);
      });
    }
  }, [onUpload]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/csv': ['.csv'],
      'text/plain': ['.txt'],
      'application/pdf': ['.pdf'],
    },
    multiple: true,
    disabled: isLoading,
  });

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div
        {...getRootProps()}
        className={cn(
          "relative group cursor-pointer transition-all duration-300",
          "border-2 border-dashed rounded-2xl text-center",
          compact ? "p-6" : "p-12",
          isDragActive ? "border-brand-500 bg-brand-50" : "border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50",
          isLoading && "opacity-50 cursor-not-allowed"
        )}
      >
        <input {...getInputProps()} />
        
        <div className={cn("flex items-center gap-4", compact ? "flex-row text-left" : "flex-col")}>
          <div className={cn(
            "rounded-full flex items-center justify-center transition-transform duration-300 group-hover:scale-110 shrink-0",
            compact ? "w-12 h-12" : "w-16 h-16",
            isDragActive ? "bg-brand-100 text-brand-600" : "bg-zinc-100 text-zinc-500"
          )}>
            {isLoading ? (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
              >
                <Upload className={compact ? "w-6 h-6" : "w-8 h-8"} />
              </motion.div>
            ) : (
              <Upload className={compact ? "w-6 h-6" : "w-8 h-8"} />
            )}
          </div>
          
          <div className="flex-1">
            <h3 className={cn("font-semibold text-zinc-900", compact ? "text-base" : "text-lg")}>
              {isLoading ? (
                progress ? `Analyzing Batch ${progress.current} of ${progress.total}...` : "Analyzing Statement..."
              ) : (compact ? "Add More Statements" : "Upload Bank Statements")}
            </h3>
            {isLoading && progress && (
              <div className={cn("w-full bg-zinc-100 rounded-full h-1.5 overflow-hidden mt-2", compact ? "" : "max-w-xs mx-auto")}>
                <motion.div 
                  className="bg-indigo-600 h-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${(progress.current / progress.total) * 100}%` }}
                  transition={{ duration: 0.5 }}
                />
              </div>
            )}
            <p className="text-xs text-zinc-500 mt-1">
              {isLoading ? "This may take a moment for multiple files." : "Drag and drop your files here to add them to your summary."}
            </p>
          </div>
          
          {!compact && (
            <div className="flex gap-2 mt-2">
              <span className="px-2 py-1 bg-zinc-100 text-zinc-600 text-xs font-medium rounded border border-zinc-200">CSV</span>
              <span className="px-2 py-1 bg-zinc-100 text-zinc-600 text-xs font-medium rounded border border-zinc-200">TXT</span>
              <span className="px-2 py-1 bg-zinc-100 text-zinc-600 text-xs font-medium rounded border border-zinc-200">PDF</span>
            </div>
          )}
        </div>
      </div>
      
      <p className="text-center text-xs text-zinc-400 mt-4">
        Your data is processed locally and analyzed by Gemini. We don't store your bank details.
      </p>
    </div>
  );
};

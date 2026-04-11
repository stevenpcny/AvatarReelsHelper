/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from "@google/genai";
import { 
  Upload, Wand2, Download, RefreshCcw, 
  Image as ImageIcon, Loader2, AlertCircle, 
  Plus, Save, Trash2, CheckCircle2, 
  Layers, Play, X, ChevronRight, ChevronLeft, Settings2,
  Square, CheckSquare, ShieldCheck, Type, Copy
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';


interface ImageItem {
  id: string;
  original: string;
  result: string | null;
  status: 'idle' | 'processing' | 'done' | 'error';
  error?: string;
  name: string;
  matchedText?: string;
  suggestedName?: string;
  shouldOptimize?: boolean;
}

interface Skill {
  id: string;
  name: string;
  prompt: string;
}

export default function App() {
  const [images, setImages] = useState<ImageItem[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);

  // Initialize Gemini AI
  const getAIInstance = () => {
    const key = geminiApiKey || process.env.API_KEY || process.env.GEMINI_API_KEY || '';
    return new GoogleGenAI({ apiKey: key });
  };
  const [currentPrompt, setCurrentPrompt] = useState('');
  const [isProcessingAll, setIsProcessingAll] = useState(false);
  const [shouldStopProcessing, setShouldStopProcessing] = useState(false);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [newSkillName, setNewSkillName] = useState('');
  const [showSkillModal, setShowSkillModal] = useState(false);
  const [editingSkillId, setEditingSkillId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isPasted, setIsPasted] = useState(false);
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const [copywriting, setCopywriting] = useState('');
  const [isMatching, setIsMatching] = useState(false);
  const [activeModule, setActiveModule] = useState<'match' | 'edit'>('match');
  const [sidebarTab, setSidebarTab] = useState<'match' | 'queue'>('match');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [aiQuestions, setAiQuestions] = useState<string[]>([]);
  const [aiAnswers, setAiAnswers] = useState<string[]>([]);
  const [currentAiStep, setCurrentAiStep] = useState<'idle' | 'asking' | 'refining'>('idle');
  const [isAuditing, setIsAuditing] = useState(false);
  const [auditProgress, setAuditProgress] = useState<string | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [downloadFolder, setDownloadFolder] = useState('');
  const [auditResults, setAuditResults] = useState<{
    id: string;
    chinese: string;
    originalEnglish: string;
    markupEnglish: string;
    correctedEnglish: string;
  }[]>([]);
  const [autoMatchWithImages, setAutoMatchWithImages] = useState(false);
  const [autoOptimizeImages, setAutoOptimizeImages] = useState(false);
  const [selectedAuditOptions, setSelectedAuditOptions] = useState<Set<string>>(new Set(['spelling', 'case', 'punctuation', 'sequence']));
  const [auditInstructions, setAuditInstructions] = useState<Record<string, string>>({
    spelling: '仅纠正拼写错误。请勿修改介词搭配，请勿进行风格润色。',
    case: '仅纠正大小写错误，确保句子首字母大写及专有名词规范。请勿修改介词搭配。',
    punctuation: '仅纠正标点符号和格式错误。请勿修改介词搭配。',
    sequence: '识别以数字序号（如 1, 2, 3）开头的段落。删除序号内部的多余空格和换行符，确保每个序号后紧跟完整的一段话。',
    custom: ''
  });

  const getCharCountColor = (count: number) => {
    if (count <= 299) return 'text-yellow-500';
    if (count >= 300 && count <= 420) return 'text-green-500';
    return 'text-red-500';
  };
  const [editingAuditId, setEditingAuditId] = useState<string | null>(null);
  const [tempAuditInstruction, setTempAuditInstruction] = useState('');
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [matchingEngine, setMatchingEngine] = useState<'gemini' | 'openrouter'>('gemini');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [openRouterApiKey, setOpenRouterApiKey] = useState('');
  const [openRouterModels, setOpenRouterModels] = useState<any[]>([]);
  const [selectedModelId, setSelectedModelId] = useState('google/gemini-flash-1.5-exp:free');
  const [customMatchingRules, setCustomMatchingRules] = useState('根据文案的情感基调和核心关键词，匹配最符合意境的图片。');
  const [viewMode, setViewMode] = useState<'grid' | 'edit'>('grid');
  const [gridSize, setGridSize] = useState<'sm' | 'md' | 'lg'>('md');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);

  // Check for API key on mount
  useEffect(() => {
    const checkKey = async () => {
      // @ts-ignore
      if (window.aistudio?.hasSelectedApiKey) {
        // @ts-ignore
        const selected = await window.aistudio.hasSelectedApiKey();
        setHasApiKey(selected);
      } else {
        setHasApiKey(true);
      }
    };
    checkKey();
  }, []);

  const handleSelectKey = async () => {
    // @ts-ignore
    if (window.aistudio?.openSelectKey) {
      // @ts-ignore
      await window.aistudio.openSelectKey();
      setHasApiKey(true);
    }
  };

  // Fetch OpenRouter models on mount
  useEffect(() => {
    const fetchModels = async () => {
      try {
        const res = await fetch('https://openrouter.ai/api/v1/models');
        const data = await res.json();
        // Filter for free multimodal models (simplified check)
        const freeModels = data.data.filter((m: any) => 
          m.pricing.prompt === "0" && 
          (m.description?.toLowerCase().includes('vision') || m.name?.toLowerCase().includes('vision') || m.id?.includes('gemini') || m.id?.includes('claude-3') || m.id?.includes('pixtral'))
        );
        setOpenRouterModels(freeModels);
        if (freeModels.length > 0) setSelectedModelId(freeModels[0].id);
      } catch (err) {
        console.error("Failed to fetch OpenRouter models", err);
      }
    };
    fetchModels();
  }, []);

  // Load skills and API Keys from localStorage on mount
  useEffect(() => {
    const savedSkills = localStorage.getItem('image-editor-skills');
    if (savedSkills) {
      setSkills(JSON.parse(savedSkills));
    } else {
      // Default skills
      const defaults: Skill[] = [
        { id: '1', name: '智能提亮', prompt: '在保持自然的前提下，整体调亮图片，增强细节。' },
        { id: '2', name: '背景模糊', prompt: '保持主体清晰，将背景进行自然的虚化处理。' },
        { id: '3', name: '风格转换', prompt: '将图片转换为复古胶片风格。' },
      ];
      setSkills(defaults);
      localStorage.setItem('image-editor-skills', JSON.stringify(defaults));
    }

    const savedORKey = localStorage.getItem('openrouter-api-key');
    if (savedORKey) setOpenRouterApiKey(savedORKey);

    const savedGeminiKey = localStorage.getItem('gemini-api-key');
    if (savedGeminiKey) setGeminiApiKey(savedGeminiKey);

    const savedCopywriting = localStorage.getItem('copy-matcher-copywriting');
    if (savedCopywriting) setCopywriting(savedCopywriting);

    const savedAuditResults = localStorage.getItem('copy-matcher-audit-results');
    if (savedAuditResults) {
      try {
        setAuditResults(JSON.parse(savedAuditResults));
      } catch (e) {
        console.error("Failed to parse audit results", e);
      }
    }

    const savedAuditOptions = localStorage.getItem('copy-matcher-audit-options');
    if (savedAuditOptions) {
      try {
        setSelectedAuditOptions(new Set(JSON.parse(savedAuditOptions)));
      } catch (e) {
        console.error("Failed to parse audit options", e);
      }
    }

    const savedAuditInstructions = localStorage.getItem('copy-matcher-audit-instructions');
    if (savedAuditInstructions) {
      try {
        setAuditInstructions(JSON.parse(savedAuditInstructions));
      } catch (e) {
        console.error("Failed to parse audit instructions", e);
      }
    }

    const savedMatchingRules = localStorage.getItem('copy-matcher-matching-rules');
    if (savedMatchingRules) setCustomMatchingRules(savedMatchingRules);

    const savedAutoMatch = localStorage.getItem('copy-matcher-auto-match');
    if (savedAutoMatch) setAutoMatchWithImages(JSON.parse(savedAutoMatch));

    const savedAutoOptimize = localStorage.getItem('copy-matcher-auto-optimize');
    if (savedAutoOptimize) setAutoOptimizeImages(JSON.parse(savedAutoOptimize));

    const savedEngine = localStorage.getItem('copy-matcher-engine');
    if (savedEngine) setMatchingEngine(savedEngine as 'gemini' | 'openrouter');

    const savedModel = localStorage.getItem('copy-matcher-model');
    if (savedModel) setSelectedModelId(savedModel);

    const savedImages = localStorage.getItem('copy-matcher-images');
    if (savedImages) {
      try {
        setImages(JSON.parse(savedImages));
      } catch (e) {
        console.error("Failed to load images from localStorage", e);
      }
    }
  }, []);

  // Persistence effects
  useEffect(() => {
    try {
      localStorage.setItem('copy-matcher-copywriting', copywriting);
      setLastSaved(new Date().toLocaleTimeString());
    } catch (e) {
      console.warn("Failed to save copywriting", e);
    }
  }, [copywriting]);

  useEffect(() => {
    try {
      localStorage.setItem('copy-matcher-audit-results', JSON.stringify(auditResults));
      setLastSaved(new Date().toLocaleTimeString());
    } catch (e) {
      console.warn("Failed to save audit results", e);
      if (e instanceof Error && e.name === 'QuotaExceededError') {
        // If quota exceeded, try clearing images to make room for text
        console.warn("Quota exceeded, clearing images to save text results...");
        localStorage.removeItem('copy-matcher-images');
      }
    }
  }, [auditResults]);

  useEffect(() => {
    try {
      localStorage.setItem('copy-matcher-audit-options', JSON.stringify(Array.from(selectedAuditOptions)));
    } catch (e) {
      console.warn("Failed to save audit options", e);
    }
  }, [selectedAuditOptions]);

  useEffect(() => {
    try {
      localStorage.setItem('copy-matcher-audit-instructions', JSON.stringify(auditInstructions));
    } catch (e) {
      console.warn("Failed to save audit instructions", e);
    }
  }, [auditInstructions]);

  useEffect(() => {
    try {
      localStorage.setItem('copy-matcher-matching-rules', customMatchingRules);
    } catch (e) {
      console.warn("Failed to save matching rules", e);
    }
  }, [customMatchingRules]);

  useEffect(() => {
    try {
      localStorage.setItem('copy-matcher-auto-match', JSON.stringify(autoMatchWithImages));
    } catch (e) {
      console.warn("Failed to save auto match setting", e);
    }
  }, [autoMatchWithImages]);

  useEffect(() => {
    try {
      localStorage.setItem('copy-matcher-auto-optimize', JSON.stringify(autoOptimizeImages));
    } catch (e) {
      console.warn("Failed to save auto optimize setting", e);
    }
  }, [autoOptimizeImages]);

  useEffect(() => {
    try {
      localStorage.setItem('copy-matcher-engine', matchingEngine);
    } catch (e) {
      console.warn("Failed to save engine setting", e);
    }
  }, [matchingEngine]);

  useEffect(() => {
    try {
      localStorage.setItem('copy-matcher-model', selectedModelId);
    } catch (e) {
      console.warn("Failed to save model setting", e);
    }
  }, [selectedModelId]);

  useEffect(() => {
    try {
      localStorage.setItem('copy-matcher-images', JSON.stringify(images));
    } catch (e) {
      // If images are too large for localStorage, we might get a QuotaExceededError
      console.warn("Images too large to persist in localStorage", e);
    }
  }, [images]);

  const saveOpenRouterKey = (key: string) => {
    setOpenRouterApiKey(key);
    localStorage.setItem('openrouter-api-key', key);
  };

  const saveGeminiKey = (key: string) => {
    setGeminiApiKey(key);
    localStorage.setItem('gemini-api-key', key);
  };

  const saveSkills = (updatedSkills: Skill[]) => {
    setSkills(updatedSkills);
    localStorage.setItem('image-editor-skills', JSON.stringify(updatedSkills));
  };

  const addFiles = (fileList: FileList | null) => {
    if (!fileList) return;
    
    const files = Array.from(fileList);
    if (files.length > 0) {
      const newImages: ImageItem[] = [];
      let processedCount = 0;

      files.forEach((file: File) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          newImages.push({
            id: Math.random().toString(36).substr(2, 9),
            original: reader.result as string,
            result: null,
            status: 'idle',
            name: file.name,
            shouldOptimize: true
          });
          processedCount++;
          if (processedCount === files.length) {
            setImages(prev => [...prev, ...newImages]);
            if (!selectedImageId) setSelectedImageId(newImages[0].id);
          }
        };
        reader.readAsDataURL(file);
      });
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    addFiles(e.target.files);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    addFiles(e.dataTransfer.files);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only hide overlay if we're actually leaving the container
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  };

  const processSingleImage = async (image: ImageItem, prompt: string): Promise<string | null> => {
    if (!image) return null;

    console.log(`[ImageEditor] Starting processing for: ${image.name}`);
    setImages(prev => prev.map(img => 
      img.id === image.id ? { ...img, status: 'processing', error: undefined } : img
    ));

    // Timeout protection: 60 seconds
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error("请求超时：AI 响应时间过长，请检查网络或稍后重试。")), 60000)
    );

    try {
      const ai = getAIInstance();
      const base64Data = image.original.split(',')[1];
      const mimeType = image.original.split(';')[0].split(':')[1];

      // Enhanced prompt for fidelity and size preservation
      const enhancedPrompt = `
        STRICT INSTRUCTION: 
        1. Preserve the original image's dimensions, resolution, and aspect ratio exactly.
        2. Keep all parts of the image that are not explicitly mentioned in the request completely identical to the original.
        3. Do not add any watermarks or borders.
        4. Output at the highest possible quality.
        5. Apply the following modification: ${prompt}
      `;

      console.log(`[ImageEditor] Calling Gemini API for ${image.name}...`);
      
      const apiCall = ai.models.generateContent({
        model: 'gemini-3.1-flash-image-preview',
        contents: {
          parts: [
            { inlineData: { data: base64Data, mimeType: mimeType } },
            { text: enhancedPrompt },
          ],
        },
        config: {
          imageConfig: {
            imageSize: "2K"
          }
        }
      });

      // Race the API call against the timeout
      const response = await Promise.race([apiCall, timeoutPromise]) as any;

      console.log(`[ImageEditor] API Response received for ${image.name}`);
      
      let resultUrl: string | null = null;
      if (response.candidates?.[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) {
          if (part.inlineData) {
            resultUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
            break;
          }
        }
      }

      if (resultUrl) {
        console.log(`[ImageEditor] Successfully processed ${image.name}`);
        setImages(prev => prev.map(img => 
          img.id === image.id ? { ...img, result: resultUrl, status: 'done' } : img
        ));
        return resultUrl;
      } else {
        console.warn(`[ImageEditor] No image data in response for ${image.name}`);
        throw new Error(response.text || "AI 未能生成修改后的图片。请检查指令是否清晰。");
      }
    } catch (err: any) {
      console.error(`[ImageEditor] Error processing ${image.name}:`, err);
      
      let errorMessage = err.message || "处理失败";
      
      // Handle specific error cases
      if (err.message?.includes("entity was not found") || err.message?.includes("not found")) {
        // Fallback to 2.5 model if 3.1 is not available
        console.log(`[ImageEditor] Model 3.1 not found, falling back to 2.5 for ${image.name}`);
        try {
          const ai = getAIInstance();
          const base64Data = image.original.split(',')[1];
          const mimeType = image.original.split(';')[0].split(':')[1];
          
          const fallbackResponse = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: {
              parts: [
                { inlineData: { data: base64Data, mimeType: mimeType } },
                { text: `STRICT INSTRUCTION: Preserve dimensions and fidelity. Modification: ${prompt}` },
              ],
            },
          });

          let fallbackUrl: string | null = null;
          if (fallbackResponse.candidates?.[0]?.content?.parts) {
            for (const part of fallbackResponse.candidates[0].content.parts) {
              if (part.inlineData) {
                fallbackUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                break;
              }
            }
          }

          if (fallbackUrl) {
            setImages(prev => prev.map(img => 
              img.id === image.id ? { ...img, result: fallbackUrl, status: 'done' } : img
            ));
            return fallbackUrl;
          }
        } catch (fallbackErr: any) {
          console.error(`[ImageEditor] Fallback also failed:`, fallbackErr);
        }
        
        errorMessage = "高清模型不可用或权限不足。请尝试重新授权。";
        setHasApiKey(false);
      } else if (err.message?.includes("API key")) {
        errorMessage = "API 密钥无效或未设置。";
        setHasApiKey(false);
      } else if (err.message?.includes("quota") || err.message?.includes("429")) {
        errorMessage = "达到 API 使用限额。请稍后再试。";
      } else if (err.message?.includes("safety")) {
        errorMessage = "请求被安全过滤器拦截。请尝试修改指令。";
      }

      setImages(prev => prev.map(img => 
        img.id === image.id ? { ...img, status: 'error', error: errorMessage } : img
      ));
      return null;
    }
  };

  const processAll = async (force = false) => {
    if (images.length === 0 || !currentPrompt) return;
    setIsProcessingAll(true);
    setShouldStopProcessing(false);
    
    console.log(`[ImageEditor] Starting batch processing (force=${force})`);
    
    // Process sequentially to avoid rate limits
    for (const image of images) {
      if (shouldStopProcessing) {
        console.log(`[ImageEditor] Batch processing stopped by user`);
        break;
      }
      
      // If force is true, we process everything. Otherwise only non-done.
      if (force || image.status !== 'done') {
        await processSingleImage(image, currentPrompt);
        // Small delay between requests to be gentle with the API
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    console.log(`[ImageEditor] Batch processing completed/stopped`);
    setIsProcessingAll(false);
    setShouldStopProcessing(false);
  };

  const resetAllStatuses = () => {
    setImages(prev => prev.map(img => ({ ...img, status: 'idle', result: null, error: undefined })));
  };

  const addSkill = () => {
    if (!newSkillName || !currentPrompt) return;
    
    if (editingSkillId) {
      const updatedSkills = skills.map(s => 
        s.id === editingSkillId ? { ...s, name: newSkillName, prompt: currentPrompt } : s
      );
      saveSkills(updatedSkills);
      setEditingSkillId(null);
    } else {
      const newSkill: Skill = {
        id: Math.random().toString(36).substr(2, 9),
        name: newSkillName,
        prompt: currentPrompt
      };
      saveSkills([...skills, newSkill]);
    }
    setNewSkillName('');
    setShowSkillModal(false);
    setAiQuestions([]);
    setAiAnswers([]);
    setCurrentAiStep('idle');
  };

  const handleAiRefine = async () => {
    if (!newSkillName) return;
    setIsRefining(true);
    try {
      const ai = getAIInstance();
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `用户想要创建一个名为“${newSkillName}”的修图技能。目前的指令构思是：“${currentPrompt}”。
        请作为专业的 AI 图像工程师，提出 2 个非常具体的问题，帮助用户细化这个指令，使其更具专业水准（例如：光影风格、色彩倾向、细节保留程度等）。
        请直接以 JSON 数组格式返回问题列表，例如：["问题1", "问题2"]。`,
        config: { responseMimeType: "application/json" }
      });
      const questions = JSON.parse(response.text);
      setAiQuestions(questions);
      setAiAnswers(new Array(questions.length).fill(''));
      setCurrentAiStep('asking');
    } catch (error) {
      console.error("AI Refine Error:", error);
    } finally {
      setIsRefining(false);
    }
  };

  const handleAiFinalize = async () => {
    setIsRefining(true);
    try {
      const ai = getAIInstance();
      const context = aiQuestions.map((q, i) => `问：${q}\n答：${aiAnswers[i]}`).join('\n');
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `用户想要创建一个名为“${newSkillName}”的修图技能。
        原始构思：${currentPrompt}
        补充细节：
        ${context}
        
        请根据以上信息，编写一条极其专业、精准的 AI 图像处理指令（Prompt）。
        要求：
        1. 包含具体的艺术风格、光影参数、色彩空间描述。
        2. 强调保留原始特征的同时进行优化。
        3. 语言简洁有力，适合作为 AI 模型输入。
        直接返回最终指令文本，不要包含任何解释。`,
      });
      setCurrentPrompt(response.text.trim());
      setCurrentAiStep('idle');
      setAiQuestions([]);
    } catch (error) {
      console.error("AI Finalize Error:", error);
    } finally {
      setIsRefining(false);
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const pastedText = e.clipboardData.getData('text');
    // Just update the state, don't trigger auto-audit anymore
    if (/^\s*\d+[\s.]/.test(pastedText)) {
      setCopywriting(pastedText);
    }
    setIsPasted(true);
    setTimeout(() => setIsPasted(false), 2000);
  };

  // Helper for retrying API calls with exponential backoff
  const callWithRetry = async (fn: () => Promise<any>, maxRetries = 3, initialDelay = 2000) => {
    let lastError;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        lastError = error;
        const isRetryable = error.message?.includes('503') || 
                           error.message?.includes('UNAVAILABLE') || 
                           error.message?.includes('high demand') ||
                           error.message?.includes('429') ||
                           error.message?.includes('RESOURCE_EXHAUSTED');
        
        if (isRetryable && attempt < maxRetries - 1) {
          const delay = initialDelay * Math.pow(2, attempt);
          console.log(`API call failed (attempt ${attempt + 1}), retrying in ${delay}ms...`, error);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  };

  const handleAuditCopy = async (overrideText?: string) => {
    const textToProcess = overrideText || copywriting;
    if (!textToProcess) return;
    setIsAuditing(true);
    setAuditError(null);
    setAuditResults([]);
    
    try {
      const ai = getAIInstance();
      const activeInstructions = Array.from(selectedAuditOptions)
        .map(id => `- ${id === 'custom' ? '自定义指令' : id}: ${auditInstructions[id]}`)
        .join('\n');

      // Split text into segments by number (e.g., "1. ", "2. ")
      // Handles cases where segments are joined without newlines (e.g. "English.1 中文")
      const segmentRegex = /(^|[\n\s.!?\"'])(\d{1,3}[\.\s\t]+)(?=[\"“'‘\s]*[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef])/g;
      const segments: string[] = [];
      
      // Find all matches for segment starts
      const matches = Array.from(textToProcess.matchAll(segmentRegex)) as RegExpMatchArray[];
      
      if (matches.length === 0) {
        // If no numbered segments found, treat the whole thing as one segment
        segments.push(textToProcess);
      } else {
        for (let i = 0; i < matches.length; i++) {
          const start = matches[i].index! + matches[i][1].length;
          const nextMatch = matches[i + 1];
          const end = nextMatch ? (nextMatch.index! + nextMatch[1].length) : textToProcess.length;
          segments.push(textToProcess.substring(start, end).trim());
        }
      }

      // Parse segments locally to separate Chinese and English
      const parsedSegments = segments.map(segment => {
        const idMatch = segment.match(/^(\d+[\.\s\t]+)/);
        const idStr = idMatch ? idMatch[1] : '';
        const rest = segment.substring(idStr.length);
        
        let lastChineseIndex = -1;
        // Match Chinese characters and Chinese punctuation
        const chineseRegex = /[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/;
        for (let i = 0; i < rest.length; i++) {
          if (chineseRegex.test(rest[i])) {
            lastChineseIndex = i;
          }
        }
        
        // Advance lastChineseIndex to include trailing punctuation (like quotes) that belong to the Chinese part
        if (lastChineseIndex !== -1) {
          const trailingPunctuation = /^[\s"”'’\)\]}>]+/;
          const match = rest.substring(lastChineseIndex + 1).match(trailingPunctuation);
          if (match) {
            lastChineseIndex += match[0].length;
          }
        }
        
        const chinese = lastChineseIndex !== -1 ? rest.substring(0, lastChineseIndex + 1).trim() : '';
        const english = lastChineseIndex !== -1 ? rest.substring(lastChineseIndex + 1).trim() : rest.trim();
        const id = idStr ? idStr.replace(/[\.\s\t]+$/, '') : '1';
        
        return { id, chinese, english };
      });

      // Deduplicate segments by ID to prevent duplicate results
      const uniqueParsedSegments: typeof parsedSegments = [];
      const seenIds = new Set<string>();
      for (const seg of parsedSegments) {
        if (!seenIds.has(seg.id)) {
          seenIds.add(seg.id);
          uniqueParsedSegments.push(seg);
        }
      }

      console.log(`Found ${uniqueParsedSegments.length} unique segments to audit.`);
      const batchSize = images.length > 0 ? 5 : 15;
      const totalBatches = Math.ceil(uniqueParsedSegments.length / batchSize);

      // Process in batches of 5 to avoid token limits and provide incremental updates
      for (let i = 0; i < uniqueParsedSegments.length; i += batchSize) {
        const currentBatchNum = Math.floor(i / batchSize) + 1;
        setAuditProgress(`${currentBatchNum} / ${totalBatches}`);
        
        const batchItems = uniqueParsedSegments.slice(i, i + batchSize);
        const batchText = batchItems.map(item => `${item.id}. ${item.english}`).join('\n\n');
        console.log(`Processing batch ${currentBatchNum} of ${totalBatches}`);

        // Create a timeout promise for each batch
        let timeoutId: any;
        const timeoutPromise = new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error("质检请求超时，请尝试分段处理或检查网络。")), 150000);
        });

        const auditPromise = callWithRetry(() => ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: `你是一个专业的文案质检员。请对以下英文文案进行“AI 文案质检”。
          
          待处理英文文案：
          ${batchText}
          
          质检要求：
          ${activeInstructions}
          
          特别注意：
          1. 识别以自然数字（1, 2, 3...）开头的段落。
          2. 仅对英文部分进行纠错。
          3. 绝对不要纠正介词搭配。
          4. 绝对不要进行风格润色或改写。
          5. 返回的 originalEnglish, markupEnglish, correctedEnglish 中，必须去除开头的序号和点号（例如不要返回 "1. Hello"，只返回 "Hello"）。
          6. 返回结果中包含：
             - id: 序号
             - originalEnglish: 原始英文部分（不含序号）
             - markupEnglish: 带有修改标记的英文（使用 ~~删除~~ 和 **新增** 标记差异，不含序号）
             - correctedEnglish: 修正后的纯净英文（不含序号）
          
          请以 JSON 数组格式返回结果。
          示例格式：[{"id": "1", "originalEnglish": "...", "markupEnglish": "...", "correctedEnglish": "..."}]`,
          config: { responseMimeType: "application/json" }
        }));

        let response: any;
        try {
          response = await Promise.race([auditPromise, timeoutPromise]);
        } finally {
          clearTimeout(timeoutId);
        }

        let responseText = "";
        try {
          responseText = response.text;
        } catch (e) {
          console.error("Failed to access response text:", e);
          throw new Error("AI 拒绝了该请求，可能是因为内容触发了安全策略。");
        }

        if (!responseText) {
          throw new Error("AI 未能返回有效的质检结果。");
        }

        try {
          // Clean up markdown formatting if the model ignored responseMimeType
          let cleanText = responseText.replace(/^```json\n?/g, '').replace(/```\n?$/g, '').trim();
          
          // Extract array if there's surrounding text
          const arrayStart = cleanText.indexOf('[');
          const arrayEnd = cleanText.lastIndexOf(']');
          if (arrayStart !== -1 && arrayEnd !== -1) {
            cleanText = cleanText.substring(arrayStart, arrayEnd + 1);
          }

          const batchResults = JSON.parse(cleanText);
          if (!Array.isArray(batchResults)) {
            throw new Error("返回结果格式错误（非数组）。");
          }
          
          const mergedResults = batchResults.map((res: any) => {
            const localItem = batchItems.find(item => item.id === String(res.id)) || batchItems[0];
            
            // Strip leading numbers and punctuation just in case AI still includes them
            const stripLeadingId = (text: string) => {
              if (!text) return text;
              return text.replace(/^(\d+[\.\s\t]+)/, '').trim();
            };

            return {
              ...res,
              originalEnglish: stripLeadingId(res.originalEnglish),
              markupEnglish: stripLeadingId(res.markupEnglish),
              correctedEnglish: stripLeadingId(res.correctedEnglish),
              chinese: localItem ? localItem.chinese : ''
            };
          });
          
          setAuditResults(prev => {
            const newResults = [...prev];
            for (const res of mergedResults) {
              if (!newResults.some(r => r.id === res.id)) {
                newResults.push(res);
              }
            }
            return newResults;
          });
        } catch (parseError) {
          console.error("JSON Parse Error in batch:", parseError, responseText);
          throw new Error("解析质检结果失败，可能是文案过长导致返回截断。请尝试分批处理。");
        }
      }

      // If images are present, trigger matching after all audit batches are done
      if (images.length > 0) {
        await matchImagesWithCopy();
      }
    } catch (error: any) {
      console.error("Audit Error:", error);
      setAuditError(error.message || "质检过程中发生未知错误。");
    } finally {
      setIsAuditing(false);
      setAuditProgress(null);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const CopyButton = ({ text, label }: { text: string, label?: string }) => {
    const [copied, setCopied] = useState(false);
    
    const handleCopy = (e: React.MouseEvent) => {
      e.stopPropagation();
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };

    return (
      <button 
        onClick={handleCopy}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl transition-all group relative border ${
          copied ? 'bg-red-50 border-red-200 shadow-sm' : 'hover:bg-neutral-50 border-transparent hover:border-neutral-200'
        }`}
      >
        <AnimatePresence mode="wait">
          {copied ? (
            <motion.div
              key="check"
              initial={{ scale: 0.8, opacity: 0, y: 5 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.8, opacity: 0, y: -5 }}
              className="flex items-center gap-1.5 text-red-600 font-bold text-[10px]"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>已复制</span>
            </motion.div>
          ) : (
            <motion.div
              key="copy"
              initial={{ scale: 0.8, opacity: 0, y: 5 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.8, opacity: 0, y: -5 }}
              className="flex items-center gap-1.5 text-neutral-400 group-hover:text-red-600 font-bold text-[10px]"
            >
              <Copy className="w-3.5 h-3.5" />
              {label && <span>{label}</span>}
            </motion.div>
          )}
        </AnimatePresence>
      </button>
    );
  };

  const CopyableText = ({ text, children, className = "" }: { text: string, children: React.ReactNode, className?: string }) => {
    const [copied, setCopied] = useState(false);
    const [hasBeenCopied, setHasBeenCopied] = useState(false);
    
    const handleCopy = () => {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setHasBeenCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };

    return (
      <div 
        onClick={handleCopy}
        className={`relative cursor-pointer group transition-all duration-300 ${className} ${
          copied ? 'ring-2 ring-red-400 ring-offset-2' : ''
        } ${hasBeenCopied ? '[&_div]:!text-rose-900 [&_span]:!text-rose-900' : ''}`}
      >
        <div className={`transition-all duration-300 ${copied ? 'bg-red-100/50 text-red-700' : ''}`}>
          {children}
        </div>
        <AnimatePresence>
          {copied && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: -10 }}
              className="absolute inset-0 flex items-center justify-center bg-red-600/10 backdrop-blur-[1px] rounded-2xl pointer-events-none"
            >
              <div className="bg-red-600 text-white px-3 py-1 rounded-full text-[10px] font-bold shadow-lg flex items-center gap-1.5">
                <CheckCircle2 className="w-3 h-3" />
                已复制内容
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  const exportAuditResults = (format: 'tsv' | 'json') => {
    if (auditResults.length === 0) return;
    
    let content = '';
    let fileName = `audit_results_${new Date().getTime()}`;
    let mimeType = '';
    
    if (format === 'tsv') {
      const headers = ['ID', '中文原文', '原始英文', '修正后英文'];
      const rows = auditResults.map(r => [r.id, r.chinese, r.originalEnglish, r.correctedEnglish].join('\t'));
      content = [headers.join('\t'), ...rows].join('\n');
      fileName += '.tsv';
      mimeType = 'text/tab-separated-values';
    } else {
      content = JSON.stringify({
        copywriting,
        auditResults,
        timestamp: new Date().toISOString()
      }, null, 2);
      fileName += '.json';
      mimeType = 'application/json';
    }
    
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const importBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        if (data.copywriting !== undefined) setCopywriting(data.copywriting);
        if (data.auditResults !== undefined) setAuditResults(data.auditResults);
        alert('备份恢复成功！');
      } catch (err) {
        console.error('Failed to parse backup file', err);
        alert('备份文件格式错误，恢复失败。');
      }
    };
    reader.readAsText(file);
    // Reset input
    e.target.value = '';
  };
  const toggleAuditOption = (id: string) => {
    const next = new Set(selectedAuditOptions);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedAuditOptions(next);
  };

  const openAuditEdit = (id: string) => {
    setEditingAuditId(id);
    setTempAuditInstruction(auditInstructions[id]);
    setShowAuditModal(true);
  };

  const saveAuditInstruction = () => {
    if (editingAuditId) {
      setAuditInstructions(prev => ({ ...prev, [editingAuditId]: tempAuditInstruction }));
    }
    setShowAuditModal(false);
  };

  const editSkill = (skill: Skill) => {
    setEditingSkillId(skill.id);
    setNewSkillName(skill.name);
    setCurrentPrompt(skill.prompt);
    setShowSkillModal(true);
  };

  const deleteSkill = (id: string) => {
    saveSkills(skills.filter(s => s.id !== id));
  };

  const removeImage = (id: string) => {
    setImages(prev => prev.filter(img => img.id !== id));
    if (selectedImageId === id) setSelectedImageId(null);
    const newSelected = new Set(selectedIds);
    newSelected.delete(id);
    setSelectedIds(newSelected);
  };

  const toggleSelection = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === images.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(images.map(img => img.id)));
    }
  };

  const downloadSelected = () => {
    images.forEach(img => {
      if (selectedIds.has(img.id)) {
        const link = document.createElement('a');
        link.href = img.result || img.original;
        
        // Use suggestedName (sequence number) if available, otherwise original name
        let fileName = img.suggestedName ? `${img.suggestedName}.png` : img.name;
        
        // Add folder prefix if specified
        if (downloadFolder) {
          fileName = `${downloadFolder}/${fileName}`;
        }
        
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    });
  };

  const batchProcessAndDownload = async () => {
    if (images.length === 0) return;
    setIsProcessingAll(true);
    setShouldStopProcessing(false);
    
    const downloadQueue: { url: string; fileName: string }[] = [];

    for (const image of images) {
      if (shouldStopProcessing) break;
      
      let finalUrl = image.original;
      let fileName = image.suggestedName ? `${image.suggestedName}.png` : image.name;

      if (image.shouldOptimize && currentPrompt) {
        // Process with AI
        const resultUrl = await processSingleImage(image, currentPrompt);
        if (resultUrl) finalUrl = resultUrl;
      }
      
      // Add folder prefix if specified
      if (downloadFolder) {
        fileName = `${downloadFolder}/${fileName}`;
      }

      downloadQueue.push({ url: finalUrl, fileName });
      
      // Small delay between requests to be gentle with the API
      if (image.shouldOptimize) await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    setIsProcessingAll(false);
    
    // Trigger downloads
    downloadQueue.forEach(item => {
      const link = document.createElement('a');
      link.href = item.url;
      link.download = item.fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });
  };

  const downloadAll = () => {
    images.forEach(img => {
      if (img.result) {
        const link = document.createElement('a');
        link.href = img.result;
        const fileName = img.suggestedName ? `${img.suggestedName}.png` : `edited-${img.name}`;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    });
  };

  const matchImagesWithCopy = async () => {
    if (images.length === 0 || !copywriting) return;
    setIsMatching(true);
    setAuditError(null);
    setAuditProgress(null);

    try {
      const batchSize = 5; // Process 5 images at a time to stay within token limits
      const totalBatches = Math.ceil(images.length / batchSize);
      
      for (let i = 0; i < images.length; i += batchSize) {
        const currentBatchNum = Math.floor(i / batchSize) + 1;
        setAuditProgress(`${currentBatchNum} / ${totalBatches}`);
        
        const currentImagesBatch = images.slice(i, i + batchSize);
        const imageIndices = Array.from({ length: currentImagesBatch.length }, (_, k) => i + k);

        const prompt = `
          You are an AI matching tool. I will provide you with a list of ${currentImagesBatch.length} images and a list of copywriting entries.
          Your task is to match each image with the most appropriate copywriting entry.
          
          Copywriting Entries:
          ${copywriting}
          
          Custom Matching Rules:
          ${customMatchingRules}
          
          Rules:
          1. Each image must be matched to ONE copywriting entry.
          2. Multiple images can be matched to the same entry if appropriate.
          3. Note: In the provided text, a new entry starts with a "Number + Tab" (or space if pasted from some sources). 
             The text following the number is the actual content.
          4. For each match, suggest a concise and descriptive filename (without extension) based on the copywriting.
          
          Return the result as a JSON array of objects:
          [
            { "imageIdIndex": ${imageIndices[0]}, "matchedText": "...", "suggestedName": "序号 (例如 1)" },
            ...
          ]
          The imageIdIndex MUST correspond exactly to the indices provided: ${imageIndices.join(', ')}.
          The suggestedName MUST be the natural number ID from the copywriting entry.
        `;

      let result: any[] = [];

        // Timeout after 90 seconds for each batch
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error("图片匹配请求超时。")), 150000)
        );

        const matchPromise = (async () => {
          if (matchingEngine === 'gemini') {
            const ai = getAIInstance();
            const imageParts = await Promise.all(currentImagesBatch.map(async (img) => {
              return {
                inlineData: {
                  data: img.original.split(',')[1],
                  mimeType: img.original.split(';')[0].split(':')[1]
                }
              };
            }));

            const response = await callWithRetry(() => ai.models.generateContent({
              model: 'gemini-3-flash-preview',
              contents: {
                parts: [
                  ...imageParts,
                  { text: prompt }
                ]
              },
              config: {
                responseMimeType: "application/json"
              }
            }));
            return JSON.parse(response.text);
          } else {
            // OpenRouter Logic
            const apiKey = openRouterApiKey || process.env.OPENROUTER_API_KEY;
            if (!apiKey) throw new Error("请先填写 OpenRouter API Key");

            const contentParts: any[] = [
              { type: "text", text: prompt }
            ];

            currentImagesBatch.forEach(img => {
              contentParts.push({
                type: "image_url",
                image_url: { url: img.original }
              });
            });

            const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json",
                "HTTP-Referer": window.location.origin,
                "X-Title": "AI Copy Matcher"
              },
              body: JSON.stringify({
                model: selectedModelId,
                messages: [{ role: "user", content: contentParts }],
                response_format: { type: "json_object" }
              })
            });

            if (!response.ok) {
              const errorData = await response.json();
              throw new Error(errorData.error?.message || `OpenRouter Error: ${response.status}`);
            }

            const data = await response.json();
            if (!data.choices?.[0]?.message?.content) {
              throw new Error("OpenRouter 返回了空响应。");
            }
            const content = data.choices[0].message.content;
            const parsed = JSON.parse(content);
            return Array.isArray(parsed) ? parsed : (parsed.matches || parsed.results || Object.values(parsed)[0]);
          }
        })();

        const batchResult = await Promise.race([matchPromise, timeoutPromise]) as any[];
        
        setImages(prev => {
          const next = [...prev];
          batchResult.forEach((match: any) => {
            const idx = match.imageIdIndex;
            if (idx >= 0 && idx < next.length) {
              next[idx] = {
                ...next[idx],
                matchedText: match.matchedText,
                suggestedName: match.suggestedName
              };
            }
          });
          return next;
        });
      }
    } catch (error: any) {
      console.error("Matching Error:", error);
      setAuditError(`图片匹配失败: ${error.message || "未知错误"}`);
    } finally {
      setIsMatching(false);
      setAuditProgress(null);
    }
  };

  const selectedImage = images.find(img => img.id === selectedImageId);

  return (
    <div 
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="min-h-screen bg-neutral-50 text-neutral-900 font-sans selection:bg-blue-100 flex flex-col"
    >
      {/* Top Navigation Bar */}
      <header className="h-20 bg-white border-b border-neutral-200 flex items-center justify-center px-6 z-40 shrink-0">
        <div className="flex items-center gap-16">
          {[
            { id: 'match', name: '文案匹配', icon: <Type className="w-5 h-5" /> },
            { id: 'edit', name: 'AI 修图', icon: <Wand2 className="w-5 h-5" /> },
          ].map(module => (
            <button
              key={module.id}
              onClick={() => setActiveModule(module.id as any)}
              className={`flex flex-col items-center gap-1.5 transition-all group relative py-1 ${
                activeModule === module.id ? 'text-blue-600' : 'text-neutral-400 hover:text-neutral-600'
              }`}
            >
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all ${
                activeModule === module.id ? 'bg-blue-600 text-white shadow-xl shadow-blue-100' : 'bg-neutral-50 group-hover:bg-neutral-100'
              }`}>
                {module.icon}
              </div>
              <span className="text-[10px] font-black uppercase tracking-widest">{module.name}</span>
              {activeModule === module.id && (
                <motion.div 
                  layoutId="activeTabIndicator"
                  className="absolute -bottom-2 left-0 right-0 h-1 bg-blue-600 rounded-full"
                />
              )}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden relative">
        {/* API Key Selection Overlay */}
        {hasApiKey === false && (
          <div className="absolute inset-0 z-50 bg-white/90 backdrop-blur-md flex items-center justify-center p-6 text-center">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="max-w-md space-y-6"
            >
              <div className="w-20 h-20 bg-blue-600 rounded-3xl flex items-center justify-center mx-auto shadow-xl shadow-blue-200">
                <Settings2 className="text-white w-10 h-10" />
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-bold text-neutral-900">激活高清修图模式</h2>
                <p className="text-neutral-500 text-sm leading-relaxed">
                  为了提供 2K/4K 级别的超清修图效果，我们需要您授权使用专业版 API 密钥。
                </p>
              </div>
              <div className="flex flex-col gap-3">
                <button 
                  onClick={handleSelectKey}
                  className="w-full py-4 bg-blue-600 text-white rounded-2xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-100"
                >
                  立即授权专业版密钥
                </button>
                <a 
                  href="https://ai.google.dev/gemini-api/docs/billing" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-xs text-blue-600 font-medium hover:underline"
                >
                  了解关于计费与密钥的说明
                </a>
              </div>
            </motion.div>
          </div>
        )}

        {/* Left Sidebar: Skills & Queue */}
        {activeModule !== 'audit' && (
          <aside className={`${isSidebarCollapsed ? 'w-0 opacity-0 overflow-hidden' : 'w-80 opacity-100'} border-r border-neutral-200 bg-white flex flex-col shrink-0 z-20 transition-all duration-300 relative`}>
            {/* Collapse Button */}
            <button 
              onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              className={`absolute -right-4 top-1/2 -translate-y-1/2 w-8 h-8 bg-white border border-neutral-200 rounded-full flex items-center justify-center shadow-md z-30 hover:text-blue-600 transition-all ${isSidebarCollapsed ? 'rotate-180 -right-10' : ''}`}
              title={isSidebarCollapsed ? "展开侧边栏" : "折叠侧边栏"}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            {/* Sidebar Tabs */}
            <div className="flex border-b border-neutral-100">
              <button 
                onClick={() => setSidebarTab('match')}
                className={`flex-1 py-4 text-xs font-bold uppercase tracking-widest transition-all border-b-2 ${
                  sidebarTab === 'match' ? 'border-blue-600 text-blue-600 bg-blue-50/30' : 'border-transparent text-neutral-400 hover:text-neutral-600 hover:bg-neutral-50/50'
                }`}
              >
                匹配设置
              </button>
              <button 
                onClick={() => setSidebarTab('queue')}
                className={`flex-1 py-4 text-[10px] font-bold uppercase tracking-widest transition-all border-b-2 ${
                  sidebarTab === 'queue' ? 'border-blue-600 text-blue-600 bg-blue-50/30' : 'border-transparent text-neutral-400 hover:text-neutral-600 hover:bg-neutral-50/50'
                }`}
              >
                技能 & 队列
              </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar">
              {sidebarTab === 'match' ? (
                <div className="p-5 space-y-6">
                  {/* Engine & Key */}
                  <div className="space-y-3">
                    <h2 className="text-[10px] font-black text-neutral-400 uppercase tracking-widest flex items-center gap-2">
                      <Settings2 className="w-3 h-3" />
                      匹配引擎配置
                    </h2>
                    <div className="flex gap-1 bg-neutral-100 p-1 rounded-xl">
                      <button 
                        onClick={() => setMatchingEngine('gemini')}
                        className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                          matchingEngine === 'gemini' ? 'bg-white text-blue-600 shadow-sm' : 'text-neutral-500 hover:text-neutral-700'
                        }`}
                      >
                        Gemini
                      </button>
                      <button 
                        onClick={() => setMatchingEngine('openrouter')}
                        className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                          matchingEngine === 'openrouter' ? 'bg-white text-blue-600 shadow-sm' : 'text-neutral-500 hover:text-neutral-700'
                        }`}
                      >
                        OpenRouter
                      </button>
                    </div>

                    {matchingEngine === 'gemini' && (
                      <div className="space-y-2">
                        <div className="relative">
                          <input 
                            type="password"
                            value={geminiApiKey}
                            onChange={(e) => saveGeminiKey(e.target.value)}
                            placeholder="Gemini API Key (可选)"
                            className="w-full px-3 py-2 rounded-xl border border-neutral-200 text-[10px] outline-none bg-neutral-50 focus:ring-2 focus:ring-blue-500"
                          />
                          <button 
                            onClick={handleSelectKey}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-blue-600 hover:bg-blue-50 rounded-md transition-all"
                            title="从 Google Cloud 项目选择密钥"
                          >
                            <RefreshCcw className="w-3 h-3" />
                          </button>
                        </div>
                        <p className="text-[8px] text-neutral-400 px-1">
                          留空则使用系统默认密钥。点击右侧图标可授权专业版密钥。
                        </p>
                      </div>
                    )}

                    {matchingEngine === 'openrouter' && (
                      <div className="space-y-2">
                        <input 
                          type="password"
                          value={openRouterApiKey}
                          onChange={(e) => saveOpenRouterKey(e.target.value)}
                          placeholder="OpenRouter API Key"
                          className="w-full px-3 py-2 rounded-xl border border-neutral-200 text-[10px] outline-none bg-neutral-50 focus:ring-2 focus:ring-blue-500"
                        />
                        <select 
                          value={selectedModelId}
                          onChange={(e) => setSelectedModelId(e.target.value)}
                          className="w-full px-3 py-2 rounded-xl border border-neutral-200 text-[10px] outline-none bg-neutral-50"
                        >
                          {openRouterModels.length > 0 ? (
                            openRouterModels.map(m => (
                              <option key={m.id} value={m.id}>{m.name}</option>
                            ))
                          ) : (
                            <option>正在加载模型...</option>
                          )}
                        </select>
                      </div>
                    )}
                  </div>

                  {/* Rules */}
                  <div className="space-y-3 pt-4 border-t border-neutral-100">
                    <h2 className="text-[10px] font-black text-neutral-400 uppercase tracking-widest flex items-center gap-2">
                      <Wand2 className="w-3 h-3" />
                      匹配规则
                    </h2>
                    <textarea
                      value={customMatchingRules}
                      onChange={(e) => setCustomMatchingRules(e.target.value)}
                      placeholder="输入自定义匹配逻辑..."
                      className="w-full h-24 px-3 py-2 rounded-xl border border-neutral-200 focus:ring-2 focus:ring-blue-500 outline-none text-[10px] leading-relaxed resize-none bg-neutral-50"
                    />
                  </div>

                  {/* Automation Settings */}
                  <div className="space-y-3 pt-4 border-t border-neutral-100">
                    <h2 className="text-[10px] font-black text-neutral-400 uppercase tracking-widest flex items-center gap-2">
                      <CheckSquare className="w-3 h-3" />
                      自动化设置
                    </h2>
                    <div className="flex flex-col gap-2">
                      <label className="flex items-center gap-2 cursor-pointer group">
                        <input 
                          type="checkbox" 
                          checked={autoMatchWithImages}
                          onChange={(e) => setAutoMatchWithImages(e.target.checked)}
                          className="w-4 h-4 rounded border-neutral-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-[10px] font-bold text-neutral-500 group-hover:text-neutral-700 transition-colors">自动匹配图片与文案</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer group">
                        <input 
                          type="checkbox" 
                          checked={autoOptimizeImages}
                          onChange={(e) => setAutoOptimizeImages(e.target.checked)}
                          className="w-4 h-4 rounded border-neutral-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-[10px] font-bold text-neutral-500 group-hover:text-neutral-700 transition-colors">匹配后自动执行 AI 优化</span>
                      </label>
                    </div>
                  </div>

                  <button
                    onClick={matchImagesWithCopy}
                    disabled={isMatching || images.length === 0 || !copywriting}
                    className={`w-full py-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all ${
                      isMatching || images.length === 0 || !copywriting
                        ? 'bg-neutral-100 text-neutral-300 cursor-not-allowed'
                        : 'bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-100'
                    }`}
                  >
                    {isMatching ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                    开始智能匹配
                  </button>

                  <div className="pt-6 border-t border-neutral-100">
                    <button
                      onClick={() => {
                        if (window.confirm('确定要清除所有已输入的数据、图片和质检结果吗？此操作不可撤销。')) {
                          localStorage.clear();
                          window.location.reload();
                        }
                      }}
                      className="w-full py-2.5 rounded-xl border border-red-200 text-red-500 text-[10px] font-bold hover:bg-red-50 transition-all flex items-center justify-center gap-2"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      清除所有缓存数据
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col h-full">
                  {/* Pro Tools (Merged from Lab) */}
                  <div className="p-5 border-b border-neutral-100 bg-neutral-50/30">
                    <h2 className="text-[10px] font-black text-neutral-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                      <Wand2 className="w-3 h-3" />
                      实验室 Pro 技能
                    </h2>
                    <div className="grid grid-cols-1 gap-2">
                      {[
                        { id: 'upscale', name: '超分放大 (Upscaling)', icon: <Layers className="w-3 h-3" />, prompt: '将图片分辨率提升至 4K 级别，并智能补全像素级细节，消除模糊。' },
                        { id: 'denoise', name: 'AI 降噪/锐化', icon: <RefreshCcw className="w-3 h-3" />, prompt: '消除图片噪点，增强边缘锐度，让画面变得通透清晰。' },
                        { id: 'relighting', name: '光影重构', icon: <Settings2 className="w-3 h-3" />, prompt: '重新模拟环境光效，增加电影感侧光或夕阳暖光，重塑氛围。' },
                      ].map(tool => (
                        <button
                          key={tool.id}
                          onClick={() => setCurrentPrompt(tool.prompt)}
                          className={`flex items-center gap-3 p-2.5 rounded-xl text-left transition-all border ${
                            currentPrompt === tool.prompt ? 'bg-blue-600 border-blue-600 text-white shadow-md' : 'bg-white border-neutral-100 text-neutral-600 hover:border-blue-300'
                          }`}
                        >
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${currentPrompt === tool.prompt ? 'bg-white/20' : 'bg-neutral-50 text-neutral-400'}`}>
                            {tool.icon}
                          </div>
                          <span className="text-[10px] font-bold truncate">{tool.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Custom Skills Section */}
                  <div className="p-5 border-b border-neutral-100">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-[10px] font-black text-neutral-400 uppercase tracking-widest">自定义技能</h2>
                      <button 
                        onClick={() => {
                          setEditingSkillId(null);
                          setNewSkillName('');
                          setAiQuestions([]);
                          setAiAnswers([]);
                          setCurrentAiStep('idle');
                          setShowSkillModal(true);
                        }} 
                        className="p-1 text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {skills.map(skill => (
                        <div key={skill.id} className="relative group">
                          <button
                            onClick={() => setCurrentPrompt(skill.prompt)}
                            className={`w-full text-left px-3 py-2 rounded-xl text-[10px] font-bold border transition-all truncate hover:shadow-sm active:scale-95 ${
                              currentPrompt === skill.prompt ? 'bg-blue-600 border-blue-600 text-white shadow-md shadow-blue-100' : 'bg-white border-neutral-200 text-neutral-600 hover:border-blue-300 hover:bg-neutral-50'
                            }`}
                          >
                            {skill.name}
                          </button>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingSkillId(skill.id);
                              setNewSkillName(skill.name);
                              setCurrentPrompt(skill.prompt);
                              setShowSkillModal(true);
                            }}
                            className="absolute -top-1 -right-1 w-4 h-4 bg-white border border-neutral-200 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all shadow-sm hover:text-blue-600"
                          >
                            <Settings2 className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Queue Section */}
                  <div className="flex-1 flex flex-col min-h-0">
                    <div className="p-5 border-b border-neutral-100 flex items-center justify-between bg-neutral-50/50">
                      <h2 className="text-[10px] font-black text-neutral-400 uppercase tracking-widest">图片队列 ({images.length})</h2>
                      <button onClick={() => fileInputRef.current?.click()} className="text-blue-600">
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
                      {images.map(img => (
                        <div 
                          key={img.id}
                          onClick={() => { setSelectedImageId(img.id); setViewMode('edit'); }}
                          className={`p-2 rounded-xl border transition-all cursor-pointer flex items-center gap-3 group hover:scale-[1.02] hover:shadow-sm ${
                            selectedImageId === img.id ? 'bg-blue-50 border-blue-200 shadow-inner' : 'bg-white border-neutral-100 hover:border-neutral-200'
                          }`}
                        >
                          <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 relative">
                            <img src={img.original} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                            {img.status === 'processing' && <div className="absolute inset-0 bg-black/40 flex items-center justify-center"><Loader2 className="w-3 h-3 text-white animate-spin" /></div>}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[10px] font-bold truncate">{img.name}</p>
                            <div className={`w-1.5 h-1.5 rounded-full ${
                              img.status === 'done' ? 'bg-green-500' : img.status === 'processing' ? 'bg-blue-500' : 'bg-neutral-300'
                            }`} />
                          </div>
                          <button onClick={(e) => { e.stopPropagation(); removeImage(img.id); }} className="p-1 text-neutral-300 hover:text-red-500 opacity-0 group-hover:opacity-100">
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </aside>
        )}

        {/* Main Content Area */}
        <main className="flex-1 flex flex-col bg-neutral-50 overflow-hidden">
          {activeModule === 'match' ? (
            <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
              <div className="max-w-4xl mx-auto space-y-8">
                {/* Audit & Match Section */}
                <div className="bg-white rounded-[2.5rem] border border-neutral-200 shadow-xl shadow-neutral-100 overflow-hidden">
                  <div className="p-8 border-b border-neutral-100 bg-neutral-50/50 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-100">
                        <Type className="text-white w-6 h-6" />
                      </div>
                      <div>
                        <h2 className="text-xl font-bold text-neutral-900">文案质检与匹配</h2>
                        <p className="text-xs text-neutral-400 font-medium">检查文案、匹配图片并导出结果</p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="p-8 space-y-8">
                    {/* Input Area */}
                    <div className="space-y-4">
                      <div className="flex items-center justify-between px-2">
                        <span className="text-[10px] font-black text-neutral-400 uppercase tracking-widest">文案库 (支持 1. 中 2. 英 格式)</span>
                        <span className={`text-[10px] font-bold ${getCharCountColor(copywriting.length)}`}>{copywriting.length} 字符</span>
                      </div>
                      <textarea
                        value={copywriting}
                        onChange={(e) => setCopywriting(e.target.value)}
                        onPaste={handlePaste}
                        placeholder="1 中文内容 English content...&#10;2 中文内容 English content..."
                        className={`w-full h-64 px-6 py-4 rounded-3xl border focus:ring-4 outline-none text-base leading-relaxed resize-none font-mono transition-all duration-500 ${
                          isPasted 
                            ? 'bg-green-50 border-green-400 ring-green-500/20 text-green-800' 
                            : 'bg-neutral-50/50 border-neutral-200 focus:ring-blue-500/10 focus:border-blue-500'
                        }`}
                      />
                    </div>

                    {/* Options Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                      {[
                        { id: 'spelling', name: '拼写校对', desc: '纠正拼写错误' },
                        { id: 'case', name: '大小写规范', desc: '统一专业名词' },
                        { id: 'punctuation', name: '标点格式化', desc: '规范全半角符号' },
                        { id: 'sequence', name: '序列清洗', desc: '重构序号与空格' }
                      ].map(opt => (
                        <button
                          key={opt.id}
                          onClick={() => toggleAuditOption(opt.id)}
                          className={`p-4 rounded-2xl border text-left transition-all relative group ${
                            selectedAuditOptions.has(opt.id) 
                              ? 'bg-blue-50 border-blue-200 ring-2 ring-blue-500/5' 
                              : 'bg-white border-neutral-100 hover:border-neutral-200'
                          }`}
                        >
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-3 transition-all ${
                            selectedAuditOptions.has(opt.id) ? 'bg-blue-600 text-white' : 'bg-neutral-50 text-neutral-400'
                          }`}>
                            <Type className="w-4 h-4" />
                          </div>
                          <p className={`text-xs font-bold mb-1 ${selectedAuditOptions.has(opt.id) ? 'text-blue-600' : 'text-neutral-700'}`}>{opt.name}</p>
                          <p className="text-[10px] text-neutral-400 leading-tight">{opt.desc}</p>
                          <div 
                            onClick={(e) => { e.stopPropagation(); openAuditEdit(opt.id); }}
                            className="absolute top-4 right-4 p-1.5 text-neutral-300 hover:text-blue-600 opacity-0 group-hover:opacity-100 transition-all rounded-md hover:bg-white"
                          >
                            <Settings2 className="w-3.5 h-3.5" />
                          </div>
                        </button>
                      ))}
                    </div>

                    {/* Custom Prompt */}
                    <div className="p-6 bg-neutral-50 rounded-3xl border border-neutral-100 space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Wand2 className="w-4 h-4 text-blue-600" />
                          <span className="text-xs font-bold text-neutral-700">自定义质检指令</span>
                        </div>
                        <button 
                          onClick={() => toggleAuditOption('custom')}
                          className={`px-3 py-1 rounded-full text-[10px] font-bold transition-all ${
                            selectedAuditOptions.has('custom') ? 'bg-blue-600 text-white' : 'bg-neutral-200 text-neutral-500'
                          }`}
                        >
                          {selectedAuditOptions.has('custom') ? '已启用' : '未启用'}
                        </button>
                      </div>
                      <textarea
                        value={auditInstructions['custom']}
                        onChange={(e) => setAuditInstructions(prev => ({ ...prev, custom: e.target.value }))}
                        placeholder="输入额外的质检要求，例如：不要纠正介词搭配，不要风格润色..."
                        className="w-full h-20 px-4 py-3 rounded-2xl border border-neutral-200 focus:ring-2 focus:ring-blue-500 outline-none text-xs leading-relaxed resize-none bg-white"
                      />
                    </div>

                    <div className="flex gap-4">
                      <button
                        onClick={() => handleAuditCopy()}
                        disabled={isAuditing || isMatching || !copywriting}
                        className={`flex-[3] py-5 rounded-[2rem] font-bold flex items-center justify-center gap-3 transition-all shadow-xl active:scale-[0.98] ${
                          isAuditing || isMatching || !copywriting
                            ? 'bg-neutral-100 text-neutral-400 cursor-not-allowed shadow-none'
                            : 'bg-blue-600 text-white hover:bg-blue-700 hover:shadow-blue-200 shadow-blue-100'
                        }`}
                      >
                        {isAuditing ? (
                          <>
                            <Loader2 className="w-6 h-6 animate-spin" />
                            正在质检 {auditProgress ? `(${auditProgress})` : ''}...
                          </>
                        ) : isMatching ? (
                          <>
                            <Loader2 className="w-6 h-6 animate-spin" />
                            正在匹配 {auditProgress ? `(${auditProgress})` : ''}...
                          </>
                        ) : (
                          <>
                            <ShieldCheck className="w-6 h-6" />
                            {images.length > 0 ? '开始质检 & 匹配' : '开始质检'}
                          </>
                        )}
                      </button>

                      <button
                        onClick={() => {
                          if (window.confirm('确定要清空当前文案和质检结果，开始新的任务吗？')) {
                            setCopywriting('');
                            setAuditResults([]);
                            setAuditError(null);
                            setAuditProgress(null);
                          }
                        }}
                        className="flex-1 py-5 rounded-[2rem] bg-white border-2 border-neutral-100 text-neutral-400 font-bold flex items-center justify-center gap-2 hover:bg-neutral-50 hover:border-neutral-200 transition-all active:scale-[0.98]"
                        title="开启新任务"
                      >
                        <Plus className="w-6 h-6" />
                        <span className="hidden md:inline">新任务</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Audit Results Section */}
                {auditError && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-6 bg-red-50 border border-red-200 rounded-[2rem] flex items-center gap-4 text-red-600 shadow-sm"
                  >
                    <AlertCircle className="w-6 h-6 shrink-0" />
                    <div className="flex-1">
                      <p className="font-bold text-sm">质检失败</p>
                      <p className="text-xs opacity-80">{auditError}</p>
                    </div>
                    <button 
                      onClick={() => handleAuditCopy()}
                      className="px-4 py-2 bg-red-600 text-white rounded-xl text-xs font-bold hover:bg-red-700 transition-all"
                    >
                      重试
                    </button>
                  </motion.div>
                )}

                {auditResults.length > 0 && (
                  <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-4"
                  >
                    <div className="flex items-center justify-between px-4">
                      <div className="flex flex-col">
                        <h3 className="text-sm font-bold text-neutral-800 flex items-center gap-2">
                          <CheckCircle2 className="w-5 h-5 text-green-500" />
                          质检审查列表 ({auditResults.length})
                        </h3>
                        {lastSaved && (
                          <span className="text-[9px] text-neutral-400 mt-0.5">上次自动保存: {lastSaved}</span>
                        )}
                      </div>
                      <div className="flex gap-4">
                        <button 
                          onClick={() => exportAuditResults('tsv')}
                          className="text-xs font-bold text-green-600 hover:underline flex items-center gap-1.5"
                        >
                          <Download className="w-3.5 h-3.5" />
                          导出 Excel (TSV)
                        </button>
                        <button 
                          onClick={() => exportAuditResults('json')}
                          className="text-xs font-bold text-neutral-500 hover:underline flex items-center gap-1.5"
                        >
                          <Save className="w-3.5 h-3.5" />
                          备份 JSON
                        </button>
                        <button 
                          onClick={() => backupInputRef.current?.click()}
                          className="text-xs font-bold text-neutral-500 hover:underline flex items-center gap-1.5"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          恢复备份
                        </button>
                        <input 
                          type="file" 
                          ref={backupInputRef} 
                          onChange={importBackup} 
                          accept=".json" 
                          className="hidden" 
                        />
                        <button 
                          onClick={() => {
                            if (window.confirm('确定要清空所有质检结果吗？')) {
                              setAuditResults([]);
                            }
                          }}
                          className="text-xs font-bold text-red-500 hover:underline flex items-center gap-1.5"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          清空结果
                        </button>
                        <button 
                          onClick={() => {
                            const tsv = auditResults.map(r => `${r.id}\t${r.chinese}\t${r.correctedEnglish}`).join('\n');
                            copyToClipboard(tsv);
                          }}
                          className="text-xs font-bold text-blue-600 hover:underline flex items-center gap-1.5"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          拷贝全部 (Sheets 格式)
                        </button>
                        <button 
                          onClick={() => setCopywriting(auditResults.map(r => `${r.id} ${r.chinese} ${r.correctedEnglish}`).join('\n'))}
                          className="text-xs font-bold text-blue-600 hover:underline flex items-center gap-1.5"
                        >
                          <RefreshCcw className="w-3.5 h-3.5" />
                          同步到文案库
                        </button>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-1 gap-4">
                      {auditResults.map((res, i) => (
                        <div key={i} className="apple-card overflow-hidden flex flex-col transition-all hover:shadow-md">
                          <div className="px-6 py-4 bg-neutral-50/50 border-b border-neutral-100 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <span className="px-2 py-0.5 bg-neutral-200 text-[10px] font-black text-neutral-500 rounded-md uppercase tracking-widest">段落 {res.id}</span>
                              <span className="text-base font-bold text-neutral-800">{res.chinese}</span>
                            </div>
                            <div className="text-[10px] font-medium text-neutral-400">
                              字符数: <span className={`font-bold ${getCharCountColor(res.correctedEnglish.length)}`}>{res.correctedEnglish.length}</span>
                            </div>
                          </div>
                          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Original with Markup */}
                            <div className="space-y-2 group">
                              <div className="flex items-center justify-between">
                                <span className="text-[9px] font-black text-neutral-300 uppercase tracking-widest">对比审查 (Markup)</span>
                                <CopyButton text={res.originalEnglish} />
                              </div>
                              <CopyableText text={res.originalEnglish} className="rounded-2xl">
                                <div className="p-4 bg-neutral-50 rounded-2xl border border-dashed border-neutral-200 text-sm leading-relaxed text-neutral-500 min-h-[80px]">
                                  {res.markupEnglish.split(/(\*\*.*?\*\*|~~.*?~~)/).map((part, idx) => {
                                    if (part.startsWith('**') && part.endsWith('**')) {
                                      return <span key={idx} className="bg-green-100 text-green-700 px-1 rounded font-bold">{part.slice(2, -2)}</span>;
                                    }
                                    if (part.startsWith('~~') && part.endsWith('~~')) {
                                      return <span key={idx} className="bg-red-100 text-red-700 px-1 rounded line-through">{part.slice(2, -2)}</span>;
                                    }
                                    return part;
                                  })}
                                </div>
                              </CopyableText>
                            </div>

                            {/* Corrected */}
                            <div className="space-y-2 group">
                              <div className="flex items-center justify-between">
                                <span className="text-[9px] font-black text-blue-400 uppercase tracking-widest">修正结果</span>
                                <CopyButton text={res.correctedEnglish} />
                              </div>
                              <CopyableText text={res.correctedEnglish} className="rounded-2xl">
                                <div className="p-4 bg-blue-50/30 rounded-2xl border border-blue-100 text-sm font-medium leading-relaxed text-neutral-800 min-h-[80px]">
                                  {res.correctedEnglish}
                                </div>
                              </CopyableText>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </div>
            </div>
          ) : (
            <>
              {/* Global Prompt Bar */}
              <div className="p-4 bg-white border-b border-neutral-200 shadow-sm z-10">
                <div className="max-w-[1800px] mx-auto flex gap-4 items-center">
                  {isSidebarCollapsed && (
                    <button 
                      onClick={() => setIsSidebarCollapsed(false)}
                      className="p-2 hover:bg-neutral-100 rounded-xl transition-colors text-neutral-400"
                    >
                      <Settings2 className="w-5 h-5" />
                    </button>
                  )}
                  <div className="flex-1 relative">
                    <textarea
                      value={currentPrompt}
                      onChange={(e) => setCurrentPrompt(e.target.value)}
                      placeholder={activeModule === 'match' ? "输入匹配逻辑或修图指令..." : "输入修图指令，例如：提亮背景并增强人物细节..."}
                      className="w-full h-12 px-4 py-2.5 rounded-xl border border-neutral-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none text-sm leading-relaxed pr-10"
                    />
                    <div className="absolute right-3 top-3.5 text-neutral-300">
                      <Wand2 className="w-5 h-5" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {isProcessingAll ? (
                      <button 
                        onClick={() => setShouldStopProcessing(true)}
                        className="px-6 h-12 rounded-xl font-bold flex items-center justify-center gap-2 transition-all bg-red-50 text-red-600 hover:bg-red-100"
                      >
                        <X className="w-5 h-5" />
                        停止
                      </button>
                    ) : (
                      <>
                        <button 
                          onClick={() => processAll(false)}
                          disabled={images.length === 0 || !currentPrompt}
                          className={`px-8 h-12 rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg active:scale-95 ${
                            images.length === 0 || !currentPrompt
                              ? 'bg-neutral-100 text-neutral-400 cursor-not-allowed shadow-none'
                              : 'bg-blue-600 text-white hover:bg-blue-700 hover:shadow-blue-200 hover:-translate-y-0.5 shadow-blue-100'
                          }`}
                        >
                          <Play className="w-5 h-5" />
                          批量处理
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {viewMode === 'grid' ? (
                <div className="flex-1 flex flex-col overflow-hidden">
                  {/* Grid Header */}
                  <div className="px-8 py-4 flex items-center justify-between bg-neutral-50/50 border-b border-neutral-200">
                    <div className="flex items-center gap-6">
                      <button 
                        onClick={toggleSelectAll}
                        className="flex items-center gap-2 text-xs font-bold text-neutral-500 hover:text-blue-600 transition-colors"
                      >
                        {selectedIds.size === images.length && images.length > 0 ? (
                          <CheckSquare className="w-5 h-5 text-blue-600" />
                        ) : (
                          <Square className="w-5 h-5" />
                        )}
                        全选 ({selectedIds.size}/{images.length})
                      </button>
                      <div className="flex items-center gap-2 bg-white border border-neutral-200 px-3 py-1.5 rounded-xl shadow-sm">
                        <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-tight">下载文件夹:</span>
                        <input 
                          type="text" 
                          value={downloadFolder}
                          onChange={(e) => setDownloadFolder(e.target.value)}
                          placeholder="例如: output"
                          className="text-[10px] font-bold text-neutral-700 outline-none w-24"
                        />
                      </div>
                      <button 
                        onClick={batchProcessAndDownload}
                        disabled={isProcessingAll || images.length === 0}
                        className="px-6 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 transition-all flex items-center gap-2 shadow-lg shadow-blue-100 active:scale-95 disabled:bg-neutral-200 disabled:shadow-none"
                      >
                        {isProcessingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                        批量处理并下载
                      </button>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center bg-white border border-neutral-200 p-1 rounded-xl shadow-sm">
                        {['sm', 'md', 'lg'].map((size) => (
                          <button 
                            key={size}
                            onClick={() => setGridSize(size as any)}
                            className={`px-4 py-1.5 rounded-lg text-[10px] font-bold transition-all ${gridSize === size ? 'bg-blue-600 text-white' : 'text-neutral-400 hover:text-neutral-600'}`}
                          >
                            {size === 'sm' ? '小' : size === 'md' ? '中' : '大'}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Grid Content */}
                  <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                    {images.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-center opacity-40">
                        <ImageIcon className="w-20 h-20 mb-4 text-neutral-200" />
                        <p className="text-lg font-bold text-neutral-400">拖拽图片到此处开始</p>
                      </div>
                    ) : (
                      <div className="max-w-[1600px] mx-auto space-y-8">
                        <div className={`grid gap-8 ${
                          gridSize === 'sm' ? 'grid-cols-2 md:grid-cols-4 lg:grid-cols-6' :
                          gridSize === 'md' ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' :
                          'grid-cols-1 md:grid-cols-2'
                        }`}>
                          {images.slice((currentPage - 1) * 12, currentPage * 12).map(img => (
                            <motion.div 
                              key={img.id}
                              layout
                              whileHover={{ y: -8, transition: { duration: 0.2 } }}
                              className="bg-white rounded-3xl border border-neutral-200 shadow-sm overflow-hidden group hover:shadow-2xl hover:border-blue-200 transition-all flex flex-col"
                            >
                              {/* Image Area */}
                              <div className="aspect-square relative bg-neutral-100 overflow-hidden cursor-pointer" onClick={() => { setSelectedImageId(img.id); setViewMode('edit'); }}>
                                <img 
                                  src={img.result || img.original} 
                                  className="w-full h-full object-contain" 
                                  referrerPolicy="no-referrer" 
                                />
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-all flex items-center justify-center">
                                  <Wand2 className="text-white opacity-0 group-hover:opacity-100 w-8 h-8 transition-all" />
                                </div>
                                <button 
                                  onClick={(e) => { e.stopPropagation(); toggleSelection(img.id); }}
                                  className="absolute top-4 left-4 p-1 bg-white/90 backdrop-blur-sm rounded-lg shadow-md hover:scale-110 transition-all"
                                >
                                  {selectedIds.has(img.id) ? (
                                    <CheckSquare className="w-6 h-6 text-blue-600" />
                                  ) : (
                                    <Square className="w-6 h-6 text-neutral-300" />
                                  )}
                                </button>
                                {img.status === 'processing' && (
                                  <div className="absolute inset-0 bg-white/60 backdrop-blur-sm flex items-center justify-center">
                                    <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
                                  </div>
                                )}
                              </div>

                              {/* Text Area */}
                              <div className="p-5 flex-1 flex flex-col gap-3 bg-white border-t border-neutral-100">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-black text-neutral-400 uppercase tracking-widest">匹配文案</span>
                                    {img.matchedText && (
                                      <span className={`text-[9px] font-bold bg-neutral-50 px-1.5 py-0.5 rounded-full border border-neutral-100 ${getCharCountColor(img.matchedText.length)}`}>
                                        {img.matchedText.length} 字符
                                      </span>
                                    )}
                                  </div>
                                  <label className="flex items-center gap-1.5 cursor-pointer group/opt">
                                    <input 
                                      type="checkbox" 
                                      checked={img.shouldOptimize}
                                      onChange={(e) => {
                                        setImages(prev => prev.map(i => i.id === img.id ? { ...i, shouldOptimize: e.target.checked } : i));
                                      }}
                                      className="w-3 h-3 rounded border-neutral-300 text-blue-600 focus:ring-blue-500"
                                    />
                                    <span className="text-[9px] font-bold text-neutral-400 group-hover/opt:text-blue-600 transition-colors">AI 优化</span>
                                  </label>
                                </div>
                                <div className="h-24 overflow-y-auto custom-scrollbar pr-1">
                                  <p className="text-xs text-neutral-600 leading-relaxed italic whitespace-pre-wrap">
                                    {img.matchedText || "尚未匹配文案..."}
                                  </p>
                                </div>
                                <div className="pt-3 border-t border-neutral-50 flex items-center justify-between">
                                  <span className="text-[9px] font-bold text-neutral-300 truncate max-w-[120px]">
                                    {img.suggestedName || img.name}
                                  </span>
                                  <button 
                                    onClick={() => { setSelectedImageId(img.id); setViewMode('edit'); }}
                                    className="text-[10px] font-bold text-blue-600 hover:underline"
                                  >
                                    编辑
                                  </button>
                                </div>
                              </div>
                            </motion.div>
                          ))}
                        </div>

                        {/* Pagination */}
                        {images.length > 12 && (
                          <div className="flex items-center justify-center gap-4 pt-8">
                            <button 
                              disabled={currentPage === 1}
                              onClick={() => setCurrentPage(prev => prev - 1)}
                              className="p-2 rounded-xl border border-neutral-200 bg-white disabled:opacity-30 hover:bg-white hover:border-blue-400 hover:text-blue-600 hover:shadow-md active:scale-90 transition-all"
                            >
                              <ChevronLeft className="w-5 h-5" />
                            </button>
                            <span className="text-sm font-bold text-neutral-500">
                              第 {currentPage} / {Math.ceil(images.length / 12)} 页
                            </span>
                            <button 
                              disabled={currentPage === Math.ceil(images.length / 12)}
                              onClick={() => setCurrentPage(prev => prev + 1)}
                              className="p-2 rounded-xl border border-neutral-200 bg-white disabled:opacity-30 hover:bg-white hover:border-blue-400 hover:text-blue-600 hover:shadow-md active:scale-90 transition-all"
                            >
                              <ChevronRight className="w-5 h-5" />
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col overflow-hidden">
                  {/* Edit Header */}
                  <div className="p-6 bg-white border-b border-neutral-200 flex items-center justify-between shadow-sm z-10">
                    <button 
                      onClick={() => setViewMode('grid')}
                      className="flex items-center gap-2 text-sm font-bold text-neutral-600 hover:text-blue-600 transition-colors"
                    >
                      <ChevronLeft className="w-5 h-5" />
                      返回列表
                    </button>
                    <div className="flex items-center gap-4">
                      <span className="text-xs font-bold text-neutral-400 uppercase tracking-widest">编辑模式</span>
                    </div>
                  </div>

                  {/* Preview Area (Editor) */}
                  <div 
                    className="flex-1 overflow-y-auto p-8 flex flex-col items-center custom-scrollbar transition-colors relative"
                  >
                    <AnimatePresence mode="wait">
                      {!selectedImage ? (
                        <motion.div 
                          key="empty"
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="flex flex-col items-center justify-center h-full text-center max-w-md"
                        >
                          <div className="w-24 h-24 bg-white rounded-3xl shadow-xl flex items-center justify-center mb-6 border border-neutral-100">
                            <ImageIcon className="text-neutral-200 w-12 h-12" />
                          </div>
                          <h3 className="text-xl font-bold text-neutral-800 mb-2">未选择图片</h3>
                          <p className="text-neutral-500 text-sm leading-relaxed">
                            请返回列表选择一张图片进行编辑。
                          </p>
                          <button 
                            onClick={() => setViewMode('grid')}
                            className="mt-8 px-6 py-3 bg-white border border-neutral-200 rounded-xl text-sm font-bold text-neutral-700 hover:bg-neutral-50 transition-all shadow-sm"
                          >
                            返回列表
                          </button>
                        </motion.div>
                      ) : (
                        <motion.div 
                          key={selectedImage.id}
                          initial={{ opacity: 0, scale: 0.99 }}
                          animate={{ opacity: 1, scale: 1 }}
                          className="w-full max-w-[1800px] grid grid-cols-1 md:grid-cols-2 gap-6"
                        >
                          {/* Original */}
                          <div className="space-y-3">
                            <div className="flex items-center justify-between px-2">
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-black text-neutral-400 uppercase tracking-[0.2em]">原始图片</span>
                                <span className="text-[10px] font-medium text-neutral-300 bg-neutral-100 px-2 py-0.5 rounded-full">{selectedImage.name}</span>
                              </div>
                            </div>
                            <div className="aspect-square md:aspect-auto md:h-[820px] bg-white rounded-[2rem] border border-neutral-200 shadow-sm overflow-hidden flex items-center justify-center p-2 group relative">
                              <img src={selectedImage.original} className="max-w-full max-h-full object-contain rounded-2xl transition-transform duration-500 group-hover:scale-[1.02]" referrerPolicy="no-referrer" />
                              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-all pointer-events-none" />
                            </div>
                          </div>

                          {/* Result */}
                          <div className="space-y-3">
                            <div className="flex items-center justify-between px-2">
                              <span className="text-[10px] font-black text-blue-500 uppercase tracking-[0.2em]">处理结果</span>
                              {selectedImage.result && (
                                <button 
                                  onClick={() => {
                                    const link = document.createElement('a');
                                    link.href = selectedImage.result!;
                                    const fileName = selectedImage.suggestedName ? `${selectedImage.suggestedName}.png` : `edited-${selectedImage.name}`;
                                    link.download = fileName;
                                    link.click();
                                  }}
                                  className="text-blue-600 hover:text-blue-700 text-[10px] font-bold flex items-center gap-1 bg-blue-50 px-3 py-1 rounded-full transition-all"
                                >
                                  <Download className="w-3 h-3" /> 下载高清原图
                                </button>
                              )}
                            </div>
                            <div className="aspect-square md:aspect-auto md:h-[820px] bg-white rounded-[2rem] border border-neutral-200 shadow-sm overflow-hidden flex items-center justify-center p-2 relative group">
                              {selectedImage.status === 'processing' ? (
                                <div className="flex flex-col items-center gap-4">
                                  <div className="relative">
                                    <Loader2 className="w-12 h-12 text-blue-600 animate-spin" />
                                    <div className="absolute inset-0 flex items-center justify-center">
                                      <div className="w-2 h-2 bg-blue-600 rounded-full animate-ping" />
                                    </div>
                                  </div>
                                  <p className="text-xs font-bold text-neutral-400 animate-pulse tracking-widest">正在重构像素级细节...</p>
                                </div>
                              ) : selectedImage.result ? (
                                <div className="relative w-full h-full flex items-center justify-center">
                                  <img src={selectedImage.result} className="max-w-full max-h-full object-contain rounded-2xl transition-transform duration-500 group-hover:scale-[1.02]" referrerPolicy="no-referrer" />
                                  <div className="absolute bottom-6 right-6 flex gap-2 opacity-0 group-hover:opacity-100 transition-all translate-y-2 group-hover:translate-y-0">
                                    <button 
                                      onClick={() => processSingleImage(selectedImage, currentPrompt)}
                                      className="px-6 py-3 bg-white/95 backdrop-blur-md border border-neutral-200 rounded-2xl text-xs font-bold text-neutral-700 hover:bg-white transition-all shadow-2xl flex items-center gap-2"
                                    >
                                      <RefreshCcw className="w-4 h-4" /> 重新生成
                                    </button>
                                  </div>
                                </div>
                              ) : selectedImage.status === 'error' ? (
                                <div className="flex flex-col items-center gap-4 text-center p-8">
                                  <AlertCircle className="w-12 h-12 text-red-400" />
                                  <p className="text-sm font-bold text-red-500">{selectedImage.error}</p>
                                  <button 
                                    onClick={() => processSingleImage(selectedImage, currentPrompt)}
                                    className="px-6 py-2 bg-red-50 text-red-600 rounded-xl text-xs font-bold hover:bg-red-100 transition-all"
                                  >
                                    立即重试
                                  </button>
                                </div>
                              ) : (
                                <div className="flex flex-col items-center gap-4 opacity-20">
                                  <Wand2 className="w-16 h-16 text-neutral-300" />
                                  <p className="text-sm font-bold text-neutral-400 tracking-widest">准备就绪，点击“批量处理”开始</p>
                                </div>
                              )}
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {/* Skill Modal */}
      <AnimatePresence>
        {showSkillModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                setShowSkillModal(false);
                setEditingSkillId(null);
                setNewSkillName('');
                setAiQuestions([]);
                setAiAnswers([]);
                setCurrentAiStep('idle');
              }}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-lg bg-white rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-8 overflow-y-auto custom-scrollbar">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h3 className="text-2xl font-bold text-neutral-900">{editingSkillId ? '优化技能' : '创建新技能'}</h3>
                    <p className="text-neutral-400 text-xs mt-1 font-medium tracking-wide">CRAFTING PROFESSIONAL AI SKILLS</p>
                  </div>
                  <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-600">
                    <Wand2 className="w-6 h-6" />
                  </div>
                </div>
                
                <div className="space-y-6">
                  <div>
                    <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest mb-2 block">技能名称</label>
                    <input 
                      type="text"
                      value={newSkillName}
                      onChange={(e) => setNewSkillName(e.target.value)}
                      placeholder="例如：复古胶片感、极简白底图..."
                      className="w-full px-5 py-4 rounded-2xl border border-neutral-200 focus:ring-2 focus:ring-blue-500 outline-none text-sm font-bold bg-neutral-50/50"
                    />
                  </div>

                  {currentAiStep === 'idle' ? (
                    <div className="space-y-4">
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest block">核心指令构思</label>
                          <button 
                            onClick={handleAiRefine}
                            disabled={!newSkillName || isRefining}
                            className="text-[10px] font-bold text-blue-600 flex items-center gap-1.5 hover:bg-blue-50 px-3 py-1 rounded-full transition-all disabled:opacity-30"
                          >
                            {isRefining ? <Loader2 className="w-3 h-3 animate-spin" /> : <Settings2 className="w-3 h-3" />}
                            AI 助手协助优化
                          </button>
                        </div>
                        <textarea 
                          value={currentPrompt}
                          onChange={(e) => setCurrentPrompt(e.target.value)}
                          placeholder="输入您的初步想法，或者让 AI 帮您完善..."
                          className="w-full px-5 py-4 rounded-2xl border border-neutral-200 focus:ring-2 focus:ring-blue-500 outline-none text-xs text-neutral-600 italic leading-relaxed min-h-[120px] resize-none bg-neutral-50/50"
                        />
                      </div>
                    </div>
                  ) : (
                    <motion.div 
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="bg-blue-50/50 rounded-3xl p-6 border border-blue-100 space-y-5"
                    >
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-8 h-8 bg-blue-600 rounded-xl flex items-center justify-center text-white">
                          <Wand2 className="w-4 h-4" />
                        </div>
                        <p className="text-xs font-bold text-blue-900">AI 助手正在为您细化技能...</p>
                      </div>
                      
                      {aiQuestions.map((q, i) => (
                        <div key={i} className="space-y-2">
                          <p className="text-[11px] font-bold text-neutral-500 leading-relaxed">{q}</p>
                          <input 
                            type="text"
                            value={aiAnswers[i]}
                            onChange={(e) => {
                              const newAnswers = [...aiAnswers];
                              newAnswers[i] = e.target.value;
                              setAiAnswers(newAnswers);
                            }}
                            placeholder="您的回答..."
                            className="w-full px-4 py-3 rounded-xl border border-blue-200 focus:ring-2 focus:ring-blue-500 outline-none text-xs bg-white"
                          />
                        </div>
                      ))}

                      <div className="flex gap-2 pt-2">
                        <button 
                          onClick={handleAiFinalize}
                          disabled={isRefining || aiAnswers.some(a => !a)}
                          className="flex-1 py-3 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 transition-all flex items-center justify-center gap-2"
                        >
                          {isRefining ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                          生成专业指令
                        </button>
                        <button 
                          onClick={() => setCurrentAiStep('idle')}
                          className="px-4 py-3 bg-white border border-blue-200 text-blue-600 rounded-xl text-xs font-bold hover:bg-blue-50 transition-all"
                        >
                          返回
                        </button>
                      </div>
                    </motion.div>
                  )}
                </div>

                <div className="flex gap-3 mt-10">
                  <button 
                    onClick={() => {
                      setShowSkillModal(false);
                      setEditingSkillId(null);
                      setNewSkillName('');
                      setAiQuestions([]);
                      setAiAnswers([]);
                      setCurrentAiStep('idle');
                    }}
                    className="flex-1 py-4 text-sm font-bold text-neutral-400 hover:text-neutral-600 transition-colors"
                  >
                    取消
                  </button>
                  <button 
                    onClick={addSkill}
                    disabled={!newSkillName || !currentPrompt}
                    className="flex-[2] py-4 bg-neutral-900 text-white rounded-2xl font-bold hover:bg-black transition-all shadow-xl shadow-neutral-200 disabled:opacity-30"
                  >
                    {editingSkillId ? '更新技能' : '保存技能'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Audit Option Modal */}
      <AnimatePresence>
        {showAuditModal && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAuditModal(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-sm bg-white rounded-3xl shadow-2xl p-6"
            >
              <h3 className="text-lg font-bold text-neutral-900 mb-4 flex items-center gap-2">
                <Settings2 className="w-5 h-5 text-blue-600" />
                微调质检指令
              </h3>
              <textarea 
                value={tempAuditInstruction}
                onChange={(e) => setTempAuditInstruction(e.target.value)}
                className="w-full h-32 px-4 py-3 rounded-2xl border border-neutral-200 focus:ring-2 focus:ring-blue-500 outline-none text-xs text-neutral-600 leading-relaxed resize-none bg-neutral-50"
                placeholder="输入该选项对应的详细指令（简体中文）..."
              />
              <div className="flex gap-2 mt-6">
                <button 
                  onClick={() => setShowAuditModal(false)}
                  className="flex-1 py-3 text-xs font-bold text-neutral-400 hover:text-neutral-600"
                >
                  取消
                </button>
                <button 
                  onClick={saveAuditInstruction}
                  className="flex-[2] py-3 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 shadow-lg shadow-blue-100"
                >
                  保存配置
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Hidden File Input */}
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleImageUpload} 
        accept="image/*" 
        multiple 
        className="hidden" 
      />

      {/* Drag and Drop Overlay */}
      <AnimatePresence>
        {isDragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-blue-600/90 backdrop-blur-sm flex flex-col items-center justify-center text-white p-12 text-center"
          >
            <motion.div
              initial={{ scale: 0.8, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="w-32 h-32 bg-white/20 rounded-full flex items-center justify-center mb-8 border-4 border-white/40 border-dashed animate-pulse"
            >
              <Upload className="w-16 h-16" />
            </motion.div>
            <h2 className="text-4xl font-black mb-4 tracking-tight">释放以上传图片</h2>
            <p className="text-blue-100 text-lg font-medium">支持批量拖拽，即刻开始 AI 智能匹配与修图</p>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #e5e7eb;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #d1d5db;
        }
      `}</style>
    </div>
  );
}

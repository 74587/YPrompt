// src/components/modules/optimize/composables/useComparison.ts

import { reactive, computed } from 'vue'
import { AIService } from '@/services/aiService'
import { useSettingsStore } from '@/stores/settingsStore'
import type { MessageAttachment } from '@/stores/promptStore'

/**
 * 对比模式类型
 * system: 系统提示词对比 - 共用输入框，两个独立系统提示词
 * user: 用户提示词对比 - 共用系统提示词，两个独立输入框
 */
export type ComparisonMode = 'system' | 'user'

/**
 * 对话消息
 */
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  isStreaming?: boolean
  attachments?: MessageAttachment[]
  isEditing?: boolean
  originalContent?: string
}

/**
 * 系统提示词对比配置
 */
export interface SystemComparisonConfig {
  leftSystemPrompt: string   // 左侧（优化前）
  rightSystemPrompt: string  // 右侧（优化后）
  sharedUserInput: string    // 共用的用户输入
}

/**
 * 用户提示词对比配置
 */
export interface UserComparisonConfig {
  sharedSystemPrompt: string  // 共用的系统提示词
  leftUserPrompt: string      // 左侧（优化前）用户提示词
  rightUserPrompt: string     // 右侧（优化后）用户提示词
}

/**
 * 对比状态
 */
interface ComparisonState {
  mode: ComparisonMode
  
  // 系统提示词对比
  systemConfig: SystemComparisonConfig
  leftMessages: ChatMessage[]   // 左侧对话历史（系统模式）
  rightMessages: ChatMessage[]  // 右侧对话历史（系统模式）
  
  // 用户提示词对比
  userConfig: UserComparisonConfig
  leftUserMessages: ChatMessage[]   // 左侧对话历史（用户模式）
  rightUserMessages: ChatMessage[]  // 右侧对话历史（用户模式）
  
  // 加载状态
  isLeftGenerating: boolean
  isRightGenerating: boolean
}

export function useComparison() {
  const settingsStore = useSettingsStore()
  const aiService = AIService.getInstance()
  const cloneAttachments = (attachments?: MessageAttachment[]) => {
    return attachments ? attachments.map(att => ({ ...att })) : []
  }
  
  const state = reactive<ComparisonState>({
    mode: 'system',
    
    systemConfig: {
      leftSystemPrompt: '',
      rightSystemPrompt: '',
      sharedUserInput: ''
    },
    leftMessages: [],
    rightMessages: [],
    
    userConfig: {
      sharedSystemPrompt: '',
      leftUserPrompt: '',
      rightUserPrompt: ''
    },
    leftUserMessages: [],
    rightUserMessages: [],
    
    isLeftGenerating: false,
    isRightGenerating: false
  })
  
  // 计算属性
  const isGenerating = computed(() => state.isLeftGenerating || state.isRightGenerating)
  
  /**
   * 初始化系统提示词对比
   */
  const initSystemComparison = (originalPrompt: string, optimizedPrompt: string) => {
    state.mode = 'system'
    state.systemConfig.leftSystemPrompt = originalPrompt
    state.systemConfig.rightSystemPrompt = optimizedPrompt
    state.systemConfig.sharedUserInput = ''
    state.leftMessages = []
    state.rightMessages = []
    
    console.log('🔵 初始化系统提示词对比:', {
      leftLength: originalPrompt.length,
      rightLength: optimizedPrompt.length
    })
  }
  
  /**
   * 初始化用户提示词对比
   */
  const initUserComparison = (
    systemPrompt: string,
    originalUserPrompt: string,
    optimizedUserPrompt: string
  ) => {
    state.mode = 'user'
    state.userConfig.sharedSystemPrompt = systemPrompt
    state.userConfig.leftUserPrompt = originalUserPrompt
    state.userConfig.rightUserPrompt = optimizedUserPrompt
    state.leftUserMessages = []
    state.rightUserMessages = []
    
    console.log('🔵 初始化用户提示词对比:', {
      systemPromptLength: systemPrompt.length,
      leftLength: originalUserPrompt.length,
      rightLength: optimizedUserPrompt.length
    })
  }
  
  /**
   * 发送消息（系统提示词对比模式）
   */
  const sendSystemMessage = async (attachments?: MessageAttachment[]) => {
    if (!state.systemConfig.sharedUserInput.trim()) return
    if (isGenerating.value) return
    
    const currentProvider = settingsStore.getAvailableProviders().find(
      p => p.id === settingsStore.selectedProvider
    )
    const currentModel = settingsStore.selectedModel
    
    if (!currentProvider || !currentModel) {
      throw new Error('请先选择AI提供商和模型')
    }
    
    const userMessage = state.systemConfig.sharedUserInput.trim()
    const userMessageId = `user-${Date.now()}`
    
    // 添加用户消息到两侧
    const baseTimestamp = new Date()
    const createUserMessage = (prefix: 'left' | 'right'): ChatMessage => ({
      id: `${prefix}-${userMessageId}`,
      role: 'user',
      content: userMessage,
      timestamp: baseTimestamp,
      attachments: cloneAttachments(attachments)
    })
    state.leftMessages.push(createUserMessage('left'))
    state.rightMessages.push(createUserMessage('right'))
    
    // 清空输入
    state.systemConfig.sharedUserInput = ''
    
    // 并发调用两侧 AI
    const leftPromise = callAI(
      'left',
      state.systemConfig.leftSystemPrompt,
      state.leftMessages
    )
    const rightPromise = callAI(
      'right',
      state.systemConfig.rightSystemPrompt,
      state.rightMessages
    )
    
    await Promise.all([leftPromise, rightPromise])
  }
  
  /**
   * 发送消息到左侧（用户提示词对比模式）
   */
  const sendLeftUserMessage = async (attachments?: MessageAttachment[]) => {
    if (!state.userConfig.leftUserPrompt.trim()) return
    if (state.isLeftGenerating) return
    
    const currentProvider = settingsStore.getAvailableProviders().find(
      p => p.id === settingsStore.selectedProvider
    )
    const currentModel = settingsStore.selectedModel
    
    if (!currentProvider || !currentModel) {
      throw new Error('请先选择AI提供商和模型')
    }
    
    const userMessage = state.userConfig.leftUserPrompt.trim()
    const userMessageId = `left-user-${Date.now()}`
    
    // 添加用户消息
    const userMsg: ChatMessage = {
      id: userMessageId,
      role: 'user',
      content: userMessage,
      timestamp: new Date(),
      attachments: cloneAttachments(attachments)
    }
    state.leftUserMessages.push(userMsg)
    
    // 清空输入
    state.userConfig.leftUserPrompt = ''
    
    // 调用 AI
    await callAI(
      'left',
      state.userConfig.sharedSystemPrompt,
      state.leftUserMessages
    )
  }
  
  /**
   * 发送消息到右侧（用户提示词对比模式）
   */
  const sendRightUserMessage = async (attachments?: MessageAttachment[]) => {
    if (!state.userConfig.rightUserPrompt.trim()) return
    if (state.isRightGenerating) return
    
    const currentProvider = settingsStore.getAvailableProviders().find(
      p => p.id === settingsStore.selectedProvider
    )
    const currentModel = settingsStore.selectedModel
    
    if (!currentProvider || !currentModel) {
      throw new Error('请先选择AI提供商和模型')
    }
    
    const userMessage = state.userConfig.rightUserPrompt.trim()
    const userMessageId = `right-user-${Date.now()}`
    
    // 添加用户消息
    const userMsg: ChatMessage = {
      id: userMessageId,
      role: 'user',
      content: userMessage,
      timestamp: new Date(),
      attachments: cloneAttachments(attachments)
    }
    state.rightUserMessages.push(userMsg)
    
    // 清空输入
    state.userConfig.rightUserPrompt = ''
    
    // 调用 AI
    await callAI(
      'right',
      state.userConfig.sharedSystemPrompt,
      state.rightUserMessages
    )
  }
  
  /**
   * 调用 AI 获取响应
   */
  const callAI = async (
    side: 'left' | 'right',
    systemPrompt: string,
    messages: ChatMessage[]
  ) => {
    const currentProvider = settingsStore.getAvailableProviders().find(
      p => p.id === settingsStore.selectedProvider
    )
    const currentModel = settingsStore.selectedModel
    
    if (!currentProvider || !currentModel) {
      throw new Error('请先选择AI提供商和模型')
    }
    
    // 设置生成状态
    if (side === 'left') {
      state.isLeftGenerating = true
    } else {
      state.isRightGenerating = true
    }
    
    // 创建 AI 响应消息
    const aiMessageId = `${side}-ai-${Date.now()}`
    const aiMsg: ChatMessage = {
      id: aiMessageId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isStreaming: true
    }
    messages.push(aiMsg)
    
    try {
      // 构建消息历史
      const apiMessages = [
        { role: 'system' as const, content: systemPrompt },
        ...messages
          .filter(m => m.id !== aiMessageId)
          .map(m => ({
            role: m.role,
            content: m.content,
            attachments: m.attachments
          }))
      ]
      
      // 为这个特定调用创建独立的流式回调
      // 使用闭包捕获当前的 aiMessageId，避免并发时互相干扰
      const streamCallback = (chunk: string) => {
        const msg = messages.find(m => m.id === aiMessageId)
        if (msg) {
          msg.content += chunk
        }
      }
      
      // 调用 AI，传入独立的回调函数（支持并发调用）
      const response = await aiService.callAI(
        apiMessages,
        currentProvider,
        currentModel,
        true, // 流式输出
        streamCallback // 传入回调参数，而不是全局设置
      )
      
      // 更新最终响应
      const msg = messages.find(m => m.id === aiMessageId)
      if (msg) {
        msg.content = response
        msg.isStreaming = false
      }
    } catch (error: any) {
      console.error(`${side} AI call failed:`, error)
      const msg = messages.find(m => m.id === aiMessageId)
      if (msg) {
        msg.content = `❌ 错误: ${error.message}`
        msg.isStreaming = false
      }
    } finally {
      if (side === 'left') {
        state.isLeftGenerating = false
      } else {
        state.isRightGenerating = false
      }
    }
  }

  /**
   * 重新发送指定用户消息
   */
  const resendMessage = async (side: 'left' | 'right', messageId: string) => {
    const mode = state.mode
    const messageList = mode === 'system'
      ? (side === 'left' ? state.leftMessages : state.rightMessages)
      : (side === 'left' ? state.leftUserMessages : state.rightUserMessages)
    
    const targetIndex = messageList.findIndex(msg => msg.id === messageId)
    if (targetIndex === -1) return
    
    const targetMessage = messageList[targetIndex]
    if (targetMessage.role !== 'user') return
    
    if (side === 'left' && state.isLeftGenerating) return
    if (side === 'right' && state.isRightGenerating) return
    
    if (targetIndex < messageList.length - 1) {
      messageList.splice(targetIndex + 1)
    }
    
    const systemPrompt = mode === 'system'
      ? (side === 'left' ? state.systemConfig.leftSystemPrompt : state.systemConfig.rightSystemPrompt)
      : state.userConfig.sharedSystemPrompt
    
    await callAI(side, systemPrompt, messageList)
  }
  
  /**
   * 重新生成指定的AI回复
   */
  const regenerateAssistantMessage = async (side: 'left' | 'right', messageId: string) => {
    const mode = state.mode
    const messageList = mode === 'system'
      ? (side === 'left' ? state.leftMessages : state.rightMessages)
      : (side === 'left' ? state.leftUserMessages : state.rightUserMessages)
    
    const targetIndex = messageList.findIndex(msg => msg.id === messageId)
    if (targetIndex === -1) return
    const targetMessage = messageList[targetIndex]
    if (targetMessage.role !== 'assistant') return
    
    if (side === 'left' && state.isLeftGenerating) return
    if (side === 'right' && state.isRightGenerating) return
    
    // 清理目标消息及其之后的内容，保持上下文一致
    messageList.splice(targetIndex)
    
    const systemPrompt = mode === 'system'
      ? (side === 'left' ? state.systemConfig.leftSystemPrompt : state.systemConfig.rightSystemPrompt)
      : state.userConfig.sharedSystemPrompt
    
    await callAI(side, systemPrompt, messageList)
  }
  
  /**
   * 清空对话历史
   */
  const clearHistory = (side?: 'left' | 'right') => {
    if (state.mode === 'system') {
      if (!side || side === 'left') {
        state.leftMessages = []
      }
      if (!side || side === 'right') {
        state.rightMessages = []
      }
    } else {
      if (!side || side === 'left') {
        state.leftUserMessages = []
      }
      if (!side || side === 'right') {
        state.rightUserMessages = []
      }
    }
  }
  
  /**
   * 重置所有状态
   */
  const reset = () => {
    state.systemConfig = {
      leftSystemPrompt: '',
      rightSystemPrompt: '',
      sharedUserInput: ''
    }
    state.userConfig = {
      sharedSystemPrompt: '',
      leftUserPrompt: '',
      rightUserPrompt: ''
    }
    state.leftMessages = []
    state.rightMessages = []
    state.leftUserMessages = []
    state.rightUserMessages = []
    state.isLeftGenerating = false
    state.isRightGenerating = false
  }
  
  return {
    state,
    isGenerating,
    initSystemComparison,
    initUserComparison,
    sendSystemMessage,
    sendLeftUserMessage,
    sendRightUserMessage,
    resendMessage,
    regenerateAssistantMessage,
    clearHistory,
    reset
  }
}

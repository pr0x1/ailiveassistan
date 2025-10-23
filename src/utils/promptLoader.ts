/**
 * Utility functions for loading prompt content from markdown files
 */

// Fallback system instruction (same as the one with Amy)
const FALLBACK_SYSTEM_INSTRUCTION = `You are a Sales Assistant, you understand the OTC (Order-to-Cash) process in SAP, and you are capable of using the tools made available by the MCP server to execute the given requests. Do not try to invent answers if you do not have the information. When tool execution fails, explain the error clearly and suggest alternative approaches. Always maintain a helpful and professional tone in your audio responses. Only response topics related with the OTC process in SAP and just when someone mentioned the word "Amy".`;

/**
 * Load system instruction from markdown file
 * @returns Promise<string> The system instruction text
 */
export const loadSystemInstruction = async (): Promise<string> => {
  try {
    console.log('[Prompt Loader] Loading system instruction from markdown file...');
    
    // In development, load from src/prompts/system-instruction.md
    // In production, the file should be available in the build output
    const response = await fetch('/src/prompts/system-instruction.md');
    
    if (!response.ok) {
      throw new Error(`Failed to load system instruction: ${response.status} ${response.statusText}`);
    }
    
    const content = await response.text();
    
    // Extract the main instruction text (remove markdown headers and formatting)
    const cleanContent = content
      .replace(/^#.*$/gm, '') // Remove headers
      .replace(/^\*\*.*\*\*:?/gm, '') // Remove bold formatting
      .replace(/^-\s+/gm, '') // Remove bullet points
      .replace(/\n\s*\n/g, '\n') // Remove extra blank lines
      .trim();
    
    // Extract the main paragraph (first substantial text block)
    const paragraphs = cleanContent.split('\n\n');
    const mainInstruction = paragraphs.find(p => p.length > 100) || paragraphs[0] || cleanContent;
    
    console.log('[Prompt Loader] System instruction loaded successfully from markdown file');
    console.log('[Prompt Loader] Instruction length:', mainInstruction.length, 'characters');
    
    return mainInstruction;
    
  } catch (error) {
    console.error('[Prompt Loader] Failed to load system instruction from markdown file:', error);
    console.log('[Prompt Loader] Using fallback system instruction');
    
    return FALLBACK_SYSTEM_INSTRUCTION;
  }
};

/**
 * Load any prompt file from the prompts directory
 * @param filename The name of the markdown file (without extension)
 * @returns Promise<string> The prompt content
 */
export const loadPrompt = async (filename: string): Promise<string> => {
  try {
    console.log(`[Prompt Loader] Loading prompt from ${filename}.md...`);
    
    const response = await fetch(`/src/prompts/${filename}.md`);
    
    if (!response.ok) {
      throw new Error(`Failed to load prompt ${filename}: ${response.status} ${response.statusText}`);
    }
    
    const content = await response.text();
    console.log(`[Prompt Loader] Prompt ${filename} loaded successfully`);
    
    return content;
    
  } catch (error) {
    console.error(`[Prompt Loader] Failed to load prompt ${filename}:`, error);
    throw error;
  }
};

/**
 * Validate that a system instruction contains required elements
 * @param instruction The system instruction text
 * @returns boolean True if valid
 */
export const validateSystemInstruction = (instruction: string): boolean => {
  const requiredElements = [
    'Sales Assistant',
    'OTC',
    'Order-to-Cash',
    'SAP',
    'MCP server',
    'Amy'
  ];
  
  const hasAllElements = requiredElements.every(element => 
    instruction.toLowerCase().includes(element.toLowerCase())
  );
  
  const hasMinimumLength = instruction.length > 100;
  
  return hasAllElements && hasMinimumLength;
};

/**
 * Get system instruction with validation
 * @returns Promise<string> Validated system instruction
 */
export const getValidatedSystemInstruction = async (): Promise<string> => {
  const instruction = await loadSystemInstruction();
  
  if (!validateSystemInstruction(instruction)) {
    console.warn('[Prompt Loader] Loaded system instruction failed validation, using fallback');
    return FALLBACK_SYSTEM_INSTRUCTION;
  }
  
  return instruction;
};

import { GoogleGenAI } from "@google/genai";
import { WatchedItem, StockStatus } from '../types';

export const getInventoryInsight = async (items: WatchedItem[]): Promise<string> => {
  if (!process.env.API_KEY) {
    return "API Key not configured for AI insights.";
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  // Prepare a summary context to save tokens, only sending critical items
  const criticalItems = items.filter(i => i.actual_stock < i.min_stock).slice(0, 20);
  const dataSummary = JSON.stringify(criticalItems.map(i => ({
    sku: i.sku,
    name: i.name,
    stock: i.actual_stock,
    min: i.min_stock,
    status: i.status,
    sold_90d: i.total_sold_90d
  })));

  const prompt = `
    You are an inventory optimization assistant for a warehouse manager named Wahyu.
    Here is a JSON list of the top critical items (High sales, Low stock):
    ${dataSummary}

    Please provide a concise, actionable 3-bullet point summary for Wahyu. 
    Focus on which items need immediate reordering and if any high-velocity items are critically low.
    Keep the tone professional and urgent.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });
    return response.text || "No insights generated.";
  } catch (error) {
    console.error("AI Error", error);
    return "Failed to generate insights. Please try again.";
  }
};
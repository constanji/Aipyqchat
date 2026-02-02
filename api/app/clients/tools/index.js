const manifest = require('./manifest');

// Structured Tools
const DALLE3 = require('./structured/DALLE3');
const FluxAPI = require('./structured/FluxAPI');
const OpenWeather = require('./structured/OpenWeather');
const StructuredWolfram = require('./structured/Wolfram');
const createYouTubeTools = require('./structured/YouTube');
const StructuredACS = require('./structured/AzureAISearch');
const StructuredSD = require('./structured/StableDiffusion');
const GoogleSearchAPI = require('./structured/GoogleSearch');
const TraversaalSearch = require('./structured/TraversaalSearch');
const createOpenAIImageTools = require('./structured/OpenAIImageTools');
const TavilySearchResults = require('./structured/TavilySearchResults');
const Speckit = require('./structured/Speckit');
const SocialMedia = require('./structured/SocialMedia');
const BaziAstrology = require('./structured/BaziAstrology');
const DatabaseSchema = require('./structured/DatabaseSchema');
const WritingAssistant = require('./structured/WritingAssistant');
const WritingRAGAssistant = require('./structured/WritingRAGAssistant');

module.exports = {
  ...manifest,
  // Structured Tools
  DALLE3,
  FluxAPI,
  OpenWeather,
  StructuredSD,
  StructuredACS,
  GoogleSearchAPI,
  TraversaalSearch,
  StructuredWolfram,
  createYouTubeTools,
  TavilySearchResults,
  createOpenAIImageTools,
  Speckit,
  SocialMedia,
  BaziAstrology,
  DatabaseSchema,
  WritingAssistant,
  WritingRAGAssistant,
};

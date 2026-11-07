// Realistic headlines for the story-grouping tests: `group` names the event each one covers
// (headlines with no group are about something else and must stay on their own).
const H = 3600e3;
export const NOW = Date.parse('2026-11-07T12:00:00Z');
const at = (h) => new Date(NOW - h * H).toISOString();

export const SAMPLE = [
  // Gaza ceasefire, four English outlets
  { group: 'gaza', source: 'BBC News', topic: 'world', published: at(1), title: 'Israel and Hamas agree to Gaza ceasefire deal', summary: 'The agreement, brokered by Qatar and Egypt, would pause fighting and see hostages released.', image: 'https://example.com/g1.jpg' },
  { group: 'gaza', source: 'The Guardian', topic: 'world', published: at(2), title: 'Gaza ceasefire: Hamas accepts Israeli proposal, mediators say', summary: 'Qatar and Egypt say both sides have agreed to a pause in fighting and an exchange of hostages.' },
  { group: 'gaza', source: 'Al Jazeera', topic: 'world', published: at(3), title: 'Hamas and Israel reach ceasefire agreement in Gaza after weeks of talks', summary: 'Mediators in Doha announce a deal to halt the war and release captives.' },
  { group: 'gaza', source: 'Reuters', topic: 'world', published: at(1.5), title: 'Israel, Hamas agree to ceasefire in Gaza, Qatar says', summary: '' },
  // ECB rate cut, English and Portuguese
  { group: 'ecb', source: 'Financial Times', topic: 'business', published: at(5), title: 'ECB cuts interest rates for third time this year', summary: 'The European Central Bank lowered its deposit rate by a quarter point as inflation eased.' },
  { group: 'ecb', source: 'BBC News', topic: 'business', published: at(4), title: 'European Central Bank cuts interest rates again as inflation eases', summary: 'The ECB lowered borrowing costs for the eurozone for the third time this year.', image: 'https://example.com/e1.jpg' },
  { group: 'ecb-pt', source: 'ECO', topic: 'business', published: at(4.5), title: 'BCE corta taxas de juro pela terceira vez este ano', summary: 'O Banco Central Europeu desceu as taxas de juro em 25 pontos base, com a inflação a abrandar.' },
  { group: 'ecb-pt', source: 'Jornal de Negócios', topic: 'business', published: at(3.5), title: 'Lagarde anuncia novo corte das taxas de juro do BCE', summary: 'O BCE voltou a descer as taxas de juro, a terceira descida este ano.' },
  // Portuguese state budget
  { group: 'oe', source: 'Público', topic: 'portugal', published: at(6), title: 'Parlamento aprova Orçamento do Estado para 2027 na generalidade', summary: 'O Orçamento do Estado passou com a abstenção do PS.', image: 'https://example.com/o1.jpg' },
  { group: 'oe', source: 'Observador', topic: 'portugal', published: at(5.5), title: 'Orçamento do Estado 2027 aprovado na generalidade com abstenção do PS', summary: '' },
  { group: 'oe', source: 'RTP Notícias', topic: 'portugal', published: at(5), title: 'OE2027: Orçamento do Estado aprovado na generalidade', summary: 'Votação no Parlamento aprovou o documento.' },
  // Lisbon derby
  { group: 'derby', source: 'Record', topic: 'sports', published: at(14), title: 'Benfica vence Sporting no dérbi e assume a liderança', summary: 'Os encarnados venceram por 2-1 na Luz.', image: 'https://example.com/d1.jpg' },
  { group: 'derby', source: 'A Bola', topic: 'sports', published: at(13), title: 'Dérbi: Benfica bate Sporting e sobe à liderança da Liga', summary: '' },
  // New iPhone
  { group: 'iphone', source: 'The Verge', topic: 'tech', published: at(20), title: "Apple's new iPhone gets satellite messaging", summary: 'The new iPhone can send texts by satellite without a cell signal.' },
  { group: 'iphone', source: 'BBC News', topic: 'tech', published: at(21), title: 'Apple unveils new iPhone with satellite features', summary: 'Apple showed its new phones at an event in California.', image: 'https://example.com/i1.jpg' },
  // Artemis delay
  { group: 'artemis', source: 'BBC News', topic: 'science', published: at(9), title: "Nasa's Artemis II moon rocket launch delayed again", summary: 'A fuel leak has pushed back the crewed mission around the Moon.' },
  { group: 'artemis', source: 'The Guardian', topic: 'science', published: at(8), title: 'Artemis II launch postponed after fuel leak, Nasa says', summary: 'Nasa says the crewed lunar flyby will now launch next month.' },
  // Different events that share words with the groups above
  { source: 'Al Jazeera', topic: 'world', published: at(2), title: 'Israel strikes southern Lebanon as tensions rise', summary: 'Israeli jets hit targets near the border.' },
  { source: 'Bank of England', topic: 'business', published: at(6), title: 'Bank of England holds interest rates at 4%', summary: 'The Bank kept rates unchanged and signalled cuts next year.' },
  { source: 'Record', topic: 'sports', published: at(10), title: 'Sporting anuncia novo treinador após saída de Amorim', summary: '' },
  { source: 'Expresso', topic: 'portugal', published: at(7), title: 'Governo aprova aumento do salário mínimo para 2027', summary: 'O salário mínimo nacional sobe para 920 euros.' },
  { source: 'Reuters', topic: 'world', published: at(3), title: 'Trump says tariffs on China will rise next month', summary: '' },
  { source: 'NPR', topic: 'world', published: at(11), title: 'Hurricane makes landfall in Florida, millions without power', summary: '' },
  { source: 'Ars Technica', topic: 'tech', published: at(12), title: 'Microsoft patches Windows zero-day used in attacks', summary: '' },
  { source: 'DW', topic: 'world', published: at(4), title: 'Germany coalition talks collapse over budget', summary: '' },
  // Teachers' strike, three Portuguese outlets wording it differently
  { group: 'strike', source: 'Público', topic: 'portugal', published: at(2.2), title: 'Greve dos professores fecha escolas em todo o país', summary: 'Sindicatos dizem que a adesão ultrapassou os 80% no primeiro dia.', image: 'https://example.com/s1.jpg' },
  { group: 'strike', source: 'Observador', topic: 'portugal', published: at(2.6), title: 'Greve de professores: escolas fechadas de norte a sul', summary: '' },
  { group: 'strike', source: 'Jornal de Notícias', topic: 'portugal', published: at(3.1), title: 'Professores em greve fecham centenas de escolas', summary: 'Ministério da Educação fala em adesão abaixo dos 50%.' },
  // Wildfire
  { group: 'fire', source: 'Diário de Notícias', topic: 'portugal', published: at(8), title: 'Incêndio em Monchique obriga a evacuar três aldeias', summary: '' },
  { group: 'fire', source: 'Expresso', topic: 'portugal', published: at(9), title: 'Monchique: fogo obriga à evacuação de aldeias', summary: 'Mais de 300 bombeiros no terreno.' },
  // EU migration pact
  { group: 'migration', source: 'DW', topic: 'world', published: at(6), title: 'EU leaders agree on new migration pact at Brussels summit', summary: 'The deal sets shared rules for asylum claims.' },
  { group: 'migration', source: 'The Guardian', topic: 'world', published: at(6.5), title: 'Brussels summit: EU leaders agree migration pact after all-night talks', summary: '' },
  // Oil
  { group: 'opec', source: 'Guardian Business', topic: 'business', published: at(2), title: 'Oil prices jump after Opec+ agrees surprise output cut', summary: 'Brent crude rose 6% in early trading.' },
  { group: 'opec', source: 'BBC Business', topic: 'business', published: at(2.5), title: 'Opec+ surprise output cut sends oil prices higher', summary: '' },
  // Meta fine
  { group: 'meta', source: 'BBC Technology', topic: 'tech', published: at(5), title: 'EU fines Meta €800m over Marketplace practices', summary: 'Brussels says Facebook gave its own listings an unfair edge.' },
  { group: 'meta', source: 'The Verge', topic: 'tech', published: at(4.5), title: 'Meta fined €800 million by EU over Facebook Marketplace', summary: '' },
  // Cancer test
  { group: 'cancer', source: 'BBC Health', topic: 'health', published: at(5), title: 'New blood test spots bowel cancer early, trial finds', summary: 'The test caught 83% of cancers in a trial of 8,000 people.' },
  { group: 'cancer', source: 'Guardian Health', topic: 'health', published: at(6), title: 'Blood test can detect bowel cancer early, study shows', summary: '' },
  // More different events that share words with the groups above
  { source: 'RTP Notícias', topic: 'portugal', published: at(1.2), title: 'Metro de Lisboa: nova linha circular abre em 2027', summary: 'A obra entra na fase final.' },
  { source: 'Le Monde (EN)', topic: 'world', published: at(2.5), title: 'France announces snap pension reform vote in parliament', summary: 'The government will use special powers if needed.' },
  { source: 'NPR', topic: 'world', published: at(7), title: 'Supreme Court hears arguments on social media age limits', summary: '' },
  { source: 'The New York Times', topic: 'world', published: at(4), title: 'Japan’s new prime minister calls early election', summary: 'The vote is expected in December.' },
  { source: 'ECO', topic: 'business', published: at(3), title: 'TAP: Governo escolhe três finalistas para a privatização', summary: 'Air France-KLM, Lufthansa e IAG seguem na corrida.' },
  { source: 'Ars Technica', topic: 'tech', published: at(3), title: 'Google rolls out Gemini features to Android Auto', summary: '' },
  { source: 'Guardian Science', topic: 'science', published: at(10), title: 'Webb telescope spots water vapour on rocky exoplanet', summary: 'A first for a planet this small.' },
  { source: 'BBC Science', topic: 'science', published: at(16), title: 'Ocean heat hit record high in October, data shows', summary: '' },
  { source: 'SIC Notícias', topic: 'health', published: at(7), title: 'SNS: urgências de obstetrícia fechadas no fim de semana', summary: '' },
  { source: 'BBC Sport', topic: 'sports', published: at(3.5), title: 'Champions League: Arsenal beat Bayern to top group', summary: '' },
  { source: 'Record', topic: 'sports', published: at(6), title: 'Seleção: Roberto Martínez divulga convocados para novembro', summary: 'Três estreias na lista.' },
  { source: 'Guardian Culture', topic: 'culture', published: at(8), title: 'Booker prize 2026 shortlist announced', summary: 'Six novels make the cut.' },
  { source: 'Público Cultura', topic: 'culture', published: at(11), title: 'Festival de cinema de Lisboa abre com estreia mundial', summary: '' },
  { source: 'Blitz', topic: 'culture', published: at(12), title: 'Rosalía anuncia concerto em Lisboa em 2027', summary: '' },
  { source: 'Expresso', topic: 'portugal', published: at(9), title: 'Professores contratados recebem aumento a partir de janeiro', summary: 'O acordo com os sindicatos foi assinado ontem.' },
  { source: 'BBC News', topic: 'world', published: at(5), title: 'Israel and Hezbollah exchange fire across Lebanon border', summary: '' },
  { source: 'Financial Times', topic: 'business', published: at(7), title: 'Oil majors report record profits as prices stay high', summary: '' },
  { source: 'The Verge', topic: 'tech', published: at(9), title: 'Meta launches new Quest headset with mixed reality', summary: '' },
].map((h, i) => ({ id: 'h' + i, link: `https://example.com/${i}`, image: '', ...h }));

/*
 * Personal Dashboard: Meals module (meal planner + food log).
 * Plain JS, no dependencies, works from file:// as a classic <script>.
 *
 * Usage:
 *   <script src="modules/meals/meals.js"></script>
 *   PDModules.meals.mount(document.getElementById('panel'));
 *
 * The module injects its own stylesheet (meals.css next to this file) and stores
 * data in localStorage under "pd.meals.v1". It fires a "pd:meals:change" event on
 * window with today's totals whenever data changes.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'pd.meals.v1';
  var SLOTS = [['breakfast', 'Pequeno-almoço'], ['lunch', 'Almoço'], ['snack', 'Lanche'], ['dinner', 'Jantar']];
  var DAY_NAMES = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
  var MEAL_PREFIX = 'Refeição: ';
  var OLD_MEAL_PREFIX = 'Meal: ';
  var LOCALE = 'pt-PT';

  // Built-in foods, values per 100 g (drinks per 100 ml), from typical tables
  // (INSA / USDA). Cooked dishes are averages: check the label when you have one.
  // Ids never change, since saved meals and plans point at them.
  var FOOD_GROUPS = [
    // [group, [[id, name, kcal, protein, carbs, fat], ...]]
    ['Carne de vaca', [
      ['vaca-alcatra', 'Bife de vaca (alcatra), grelhado', 185, 29, 0, 7.5],
      ['vaca-lombo', 'Lombo / vazia de vaca, grelhado', 205, 28, 0, 10],
      ['vaca-entrecote', 'Entrecôte de vaca, grelhado', 280, 24, 0, 20],
      ['vaca-picanha', 'Picanha, grelhada', 250, 25, 0, 17],
      ['vaca-acem', 'Acém de vaca, estufado', 250, 30, 0, 14],
      ['vaca-rosbife', 'Rosbife', 170, 28, 0, 6],
      ['vaca-crua', 'Carne de vaca magra, crua', 120, 22, 0, 3.5],
      ['novilho-bife', 'Bife de novilho, grelhado', 175, 30, 0, 6],
      ['vitela-bife', 'Bife de vitela, grelhado', 160, 31, 0, 4],
      ['vitela-assada', 'Vitela assada', 190, 30, 0, 8],
      ['beef-mince', 'Carne picada de vaca 5% gordura, cozinhada', 164, 26, 0, 6.5],
      ['vaca-picada-20', 'Carne picada de vaca 20% gordura, cozinhada', 254, 26, 0, 17],
      ['vaca-picada-crua', 'Carne picada de vaca 5% gordura, crua', 137, 21, 0, 5],
      ['vaca-hamburguer', 'Hambúrguer de vaca, grelhado (só a carne)', 250, 26, 0, 16],
      ['vaca-figado', 'Fígado de vaca, cozinhado', 175, 27, 5, 5]
    ]],
    ['Carne de porco', [
      ['pork-loin', 'Lombo de porco, assado', 196, 27, 0, 9],
      ['porco-lombo-cru', 'Lombo de porco, cru', 143, 21, 0, 6],
      ['porco-febras', 'Febras de porco, grelhadas', 200, 28, 0, 9.5],
      ['porco-costeleta', 'Costeleta de porco, grelhada', 230, 26, 0, 14],
      ['porco-entrecosto', 'Entrecosto de porco, assado', 290, 25, 0, 21],
      ['porco-secretos', 'Secretos de porco preto, grelhados', 300, 23, 0, 23],
      ['porco-plumas', 'Plumas de porco preto, grelhadas', 260, 24, 0, 18],
      ['porco-pa', 'Pá de porco, assada', 250, 25, 0, 16],
      ['porco-perna', 'Perna de porco, assada', 220, 28, 0, 12],
      ['porco-picada', 'Carne picada de porco, cozinhada', 297, 26, 0, 21],
      ['porco-bacon', 'Bacon / toucinho, frito', 541, 37, 1.4, 42]
    ]],
    ['Aves e coelho', [
      ['chicken-breast', 'Peito de frango, grelhado', 165, 31, 0, 3.6],
      ['frango-peito-cru', 'Peito de frango, cru', 110, 23, 0, 1.2],
      ['frango-coxa', 'Coxa de frango sem pele, assada', 180, 25, 0, 8.5],
      ['frango-coxa-pele', 'Coxa de frango com pele, assada', 230, 23, 0, 15],
      ['frango-asa', 'Asas de frango, assadas', 254, 24, 0, 17],
      ['frango-assado', 'Frango assado com pele', 225, 27, 0, 13],
      ['frango-churrasco', 'Frango de churrasco com pele', 240, 26, 0.5, 15],
      ['turkey-breast', 'Peito de peru, cozinhado', 135, 30, 0, 1],
      ['peru-picado', 'Carne picada de peru, cozinhada', 200, 27, 0, 10],
      ['pato-assado', 'Pato assado com pele', 337, 19, 0, 28],
      ['coelho', 'Coelho, estufado', 200, 30, 0, 8]
    ]],
    ['Charcutaria', [
      ['ham', 'Fiambre', 145, 21, 1.5, 6],
      ['fiambre-peru', 'Fiambre de peru', 105, 18, 2, 2.5],
      ['presunto', 'Presunto', 250, 30, 0, 14],
      ['chourico', 'Chouriço', 380, 24, 2, 31],
      ['salpicao', 'Salpicão', 300, 30, 1, 20],
      ['alheira', 'Alheira, grelhada', 260, 13, 15, 16],
      ['farinheira', 'Farinheira', 350, 7, 30, 22],
      ['morcela', 'Morcela', 340, 15, 13, 26],
      ['salsichas', 'Salsichas tipo Frankfurt', 270, 12, 2, 24],
      ['mortadela', 'Mortadela', 310, 15, 3, 27]
    ]],
    ['Peixe', [
      ['cod', 'Bacalhau demolhado, cozido', 105, 23, 0, 0.9],
      ['pescada', 'Pescada, cozida', 90, 19, 0, 1.3],
      ['salmon', 'Salmão, cozinhado', 206, 22, 0, 12],
      ['salmao-fumado', 'Salmão fumado', 117, 18, 0, 4.3],
      ['dourada', 'Dourada, grelhada', 135, 24, 0, 4.5],
      ['robalo', 'Robalo, grelhado', 125, 24, 0, 3],
      ['carapau', 'Carapau, grelhado', 140, 23, 0, 5.5],
      ['sardinha-assada', 'Sardinha, assada', 180, 24, 0, 9.5],
      ['sardines', 'Sardinhas em lata, em óleo', 208, 25, 0, 11.5],
      ['cavala', 'Cavala, grelhada', 240, 24, 0, 16],
      ['atum-fresco', 'Atum fresco, grelhado', 184, 30, 0, 6.3],
      ['tuna-can', 'Atum em lata, ao natural', 116, 26, 0, 1],
      ['atum-oleo', 'Atum em lata em óleo, escorrido', 198, 29, 0, 8],
      ['peixe-espada', 'Peixe-espada preto, grelhado', 130, 20, 0, 5.5],
      ['linguado', 'Linguado, grelhado', 105, 21, 0, 2],
      ['truta', 'Truta, grelhada', 150, 23, 0, 6.5],
      ['polvo', 'Polvo, cozido', 164, 30, 4.4, 2.1],
      ['lulas', 'Lulas, grelhadas', 110, 20, 3, 1.8],
      ['choco', 'Choco, grelhado', 150, 30, 1.5, 1.4],
      ['douradinhos', 'Douradinhos / panados de peixe', 220, 12, 20, 10]
    ]],
    ['Marisco', [
      ['camarao', 'Camarão / gambas, cozido', 99, 24, 0.2, 0.3],
      ['ameijoas', 'Amêijoas, cozidas', 148, 26, 5, 2],
      ['mexilhao', 'Mexilhão, cozido', 172, 24, 7.4, 4.5],
      ['sapateira', 'Sapateira / caranguejo, cozido', 97, 19, 0, 1.5],
      ['delicias-mar', 'Delícias do mar (surimi)', 99, 7.6, 15, 0.5]
    ]],
    ['Ovos', [
      ['egg', 'Ovo (1 grande ≈ 50 g)', 143, 12.6, 0.7, 9.5],
      ['egg-white', 'Clara de ovo', 52, 10.9, 0.7, 0.2],
      ['ovo-gema', 'Gema de ovo', 322, 16, 3.6, 27],
      ['ovo-estrelado', 'Ovo estrelado', 196, 13.6, 0.8, 15],
      ['ovos-mexidos', 'Ovos mexidos', 148, 10, 1.6, 11],
      ['omelete', 'Omelete simples', 154, 10.6, 0.6, 12]
    ]],
    ['Leite, iogurtes e queijo', [
      ['milk-semi', 'Leite meio-gordo', 47, 3.4, 4.8, 1.6],
      ['leite-gordo', 'Leite gordo', 64, 3.2, 4.7, 3.6],
      ['leite-magro', 'Leite magro', 35, 3.4, 4.9, 0.1],
      ['leite-chocolate', 'Leite com chocolate', 70, 3.3, 10.5, 1.6],
      ['bebida-aveia', 'Bebida de aveia', 45, 0.5, 7, 1.5],
      ['bebida-soja', 'Bebida de soja', 39, 3.3, 2, 1.8],
      ['bebida-amendoa', 'Bebida de amêndoa sem açúcar', 13, 0.4, 0.3, 1.1],
      ['iogurte-natural', 'Iogurte natural', 61, 3.5, 4.7, 3.3],
      ['iogurte-magro', 'Iogurte natural magro', 41, 4.3, 5.5, 0.1],
      ['iogurte-aromas', 'Iogurte magro com fruta / aromas', 80, 3.5, 13, 1.2],
      ['yogurt-greek', 'Iogurte grego natural 0%', 59, 10, 3.6, 0.4],
      ['iogurte-grego', 'Iogurte grego açucarado', 150, 3.4, 16, 8],
      ['skyr', 'Skyr natural', 63, 11, 4, 0.2],
      ['iogurte-proteico', 'Iogurte proteico sem açúcar', 57, 10, 4, 0.2],
      ['cheese-fresh', 'Queijo fresco', 174, 11, 3, 13],
      ['queijo-fresco-magro', 'Queijo fresco magro', 85, 11, 3.5, 3],
      ['requeijao', 'Requeijão', 150, 10, 3.5, 11],
      ['cottage', 'Queijo cottage', 98, 11, 3.4, 4.3],
      ['queijo-flamengo', 'Queijo flamengo', 350, 26, 0.5, 27],
      ['queijo-flamengo-magro', 'Queijo flamengo magro (light)', 260, 30, 0.5, 15],
      ['cheese-cheddar', 'Queijo cheddar', 403, 25, 1.3, 33],
      ['mozzarella', 'Mozzarella fresca', 250, 18, 2, 19],
      ['parmesao', 'Queijo parmesão', 392, 36, 3.2, 26],
      ['queijo-ovelha', 'Queijo curado de ovelha', 390, 25, 0.5, 32],
      ['natas', 'Natas (35% gordura)', 340, 2, 3, 35],
      ['gelado', 'Gelado de nata', 207, 3.5, 24, 11]
    ]],
    ['Pão, cereais e bolachas', [
      ['bread-white', 'Pão branco', 265, 9, 49, 3.2],
      ['papo-seco', 'Carcaça / papo-seco', 275, 9, 56, 1.5],
      ['bread-whole', 'Pão integral', 247, 13, 41, 3.4],
      ['pao-forma', 'Pão de forma', 270, 8.5, 48, 4.5],
      ['pao-centeio', 'Pão de centeio', 259, 8.5, 48, 3.3],
      ['broa', 'Broa de milho', 220, 4.5, 45, 1.8],
      ['pao-hamburguer', 'Pão de hambúrguer', 270, 9, 48, 4],
      ['tortilha-trigo', 'Tortilha / wrap de trigo', 310, 8, 51, 8],
      ['tostas', 'Tostas', 400, 11, 75, 5],
      ['croissant', 'Croissant', 406, 8, 46, 21],
      ['oats', 'Flocos de aveia', 379, 13.2, 67.7, 6.5],
      ['corn-flakes', 'Cereais tipo corn flakes', 378, 7, 84, 0.9],
      ['muesli', 'Muesli', 370, 10, 66, 6],
      ['granola', 'Granola', 470, 10, 64, 20],
      ['farinha-trigo', 'Farinha de trigo', 364, 10, 76, 1],
      ['bolacha-agua-sal', 'Bolacha de água e sal', 430, 9.5, 70, 12],
      ['bolacha-maria', 'Bolacha Maria', 440, 7, 76, 12],
      ['bolacha-chocolate', 'Bolachas com pepitas de chocolate', 490, 5.5, 64, 24]
    ]],
    ['Arroz, massa e batata', [
      ['rice-cooked', 'Arroz branco, cozido', 130, 2.7, 28, 0.3],
      ['rice-brown-cooked', 'Arroz integral, cozido', 123, 2.7, 25.6, 1],
      ['arroz-cru', 'Arroz branco, cru', 360, 6.7, 80, 0.6],
      ['pasta-cooked', 'Massa, cozida', 158, 5.8, 31, 0.9],
      ['massa-integral', 'Massa integral, cozida', 149, 6, 30, 1.7],
      ['massa-crua', 'Massa, crua', 371, 13, 75, 1.5],
      ['cuscuz', 'Cuscuz, cozido', 112, 3.8, 23, 0.2],
      ['quinoa', 'Quinoa, cozida', 120, 4.4, 21, 1.9],
      ['potato-boiled', 'Batata cozida', 87, 1.9, 20, 0.1],
      ['batata-assada', 'Batata assada com pele', 93, 2.5, 21, 0.1],
      ['batata-frita', 'Batatas fritas (palitos)', 312, 3.4, 41, 15],
      ['batata-pacote', 'Batatas fritas de pacote', 536, 7, 53, 34],
      ['pure-batata', 'Puré de batata', 106, 2, 16, 4],
      ['sweet-potato', 'Batata-doce, assada', 90, 2, 20.7, 0.2]
    ]],
    ['Leguminosas e soja', [
      ['chickpeas', 'Grão-de-bico, cozido', 164, 8.9, 27.4, 2.6],
      ['lentils', 'Lentilhas, cozidas', 116, 9, 20, 0.4],
      ['beans-black', 'Feijão preto, cozido', 132, 8.9, 23.7, 0.5],
      ['feijao-encarnado', 'Feijão encarnado, cozido', 127, 8.7, 22.8, 0.5],
      ['feijao-branco', 'Feijão branco, cozido', 139, 9.7, 25, 0.4],
      ['feijao-frade', 'Feijão-frade, cozido', 116, 7.7, 20.8, 0.5],
      ['ervilhas', 'Ervilhas, cozidas', 84, 5.4, 15.6, 0.2],
      ['favas', 'Favas, cozidas', 110, 7.6, 19.6, 0.4],
      ['edamame', 'Edamame', 121, 12, 9, 5],
      ['tremocos', 'Tremoços', 119, 15.6, 9.9, 2.9],
      ['hummus', 'Húmus', 166, 8, 14, 9.6],
      ['tofu', 'Tofu firme', 144, 15.8, 2.8, 8.7],
      ['soja-texturizada', 'Soja texturizada (seca)', 345, 52, 30, 1]
    ]],
    ['Legumes e hortícolas', [
      ['broccoli', 'Brócolos', 34, 2.8, 6.6, 0.4],
      ['spinach', 'Espinafres', 23, 2.9, 3.6, 0.4],
      ['tomato', 'Tomate', 18, 0.9, 3.9, 0.2],
      ['lettuce', 'Alface / folhas de salada', 15, 1.4, 2.9, 0.2],
      ['rucula', 'Rúcula', 25, 2.6, 3.7, 0.7],
      ['carrot', 'Cenoura', 41, 0.9, 9.6, 0.2],
      ['onion', 'Cebola', 40, 1.1, 9.3, 0.1],
      ['alho', 'Alho', 149, 6.4, 33, 0.5],
      ['alho-frances', 'Alho-francês', 61, 1.5, 14, 0.3],
      ['couve-portuguesa', 'Couve-portuguesa', 30, 2.5, 5, 0.5],
      ['couve-galega', 'Couve-galega (caldo verde)', 40, 3, 6, 0.7],
      ['couve-flor', 'Couve-flor', 25, 1.9, 5, 0.3],
      ['couve-bruxelas', 'Couves-de-bruxelas', 43, 3.4, 9, 0.3],
      ['repolho', 'Repolho / couve lombarda', 25, 1.3, 5.8, 0.1],
      ['grelos', 'Grelos', 22, 3.2, 2.9, 0.5],
      ['feijao-verde', 'Feijão-verde', 31, 1.8, 7, 0.2],
      ['curgete', 'Curgete', 17, 1.2, 3.1, 0.3],
      ['abobora', 'Abóbora', 26, 1, 6.5, 0.1],
      ['beringela', 'Beringela', 25, 1, 6, 0.2],
      ['pimento', 'Pimento', 31, 1, 6, 0.3],
      ['pepino', 'Pepino', 15, 0.7, 3.6, 0.1],
      ['cogumelos', 'Cogumelos', 22, 3.1, 3.3, 0.3],
      ['beterraba', 'Beterraba', 43, 1.6, 9.6, 0.2],
      ['espargos', 'Espargos', 20, 2.2, 3.9, 0.1],
      ['nabo', 'Nabo', 28, 0.9, 6.4, 0.1],
      ['milho-doce', 'Milho doce (lata)', 80, 2.6, 15, 1.2],
      ['legumes-congelados', 'Mistura de legumes congelados', 60, 3, 11, 0.5],
      ['salada-mista', 'Salada mista (sem molho)', 20, 1, 3.5, 0.2]
    ]],
    ['Fruta', [
      ['banana', 'Banana', 89, 1.1, 22.8, 0.3],
      ['apple', 'Maçã', 52, 0.3, 13.8, 0.2],
      ['pera', 'Pera', 57, 0.4, 15, 0.1],
      ['orange', 'Laranja', 47, 0.9, 11.8, 0.1],
      ['tangerina', 'Tangerina', 53, 0.8, 13.3, 0.3],
      ['kiwi', 'Kiwi', 61, 1.1, 14.7, 0.5],
      ['morangos', 'Morangos', 32, 0.7, 7.7, 0.3],
      ['berries', 'Frutos vermelhos', 50, 0.8, 12, 0.3],
      ['mirtilos', 'Mirtilos', 57, 0.7, 14.5, 0.3],
      ['framboesas', 'Framboesas', 52, 1.2, 12, 0.7],
      ['uvas', 'Uvas', 69, 0.7, 18, 0.2],
      ['melancia', 'Melancia', 30, 0.6, 7.6, 0.2],
      ['melao', 'Melão', 34, 0.8, 8.2, 0.2],
      ['ananas', 'Ananás', 50, 0.5, 13, 0.1],
      ['manga', 'Manga', 60, 0.8, 15, 0.4],
      ['pessego', 'Pêssego', 39, 0.9, 9.5, 0.3],
      ['ameixa', 'Ameixa', 46, 0.7, 11.4, 0.3],
      ['cerejas', 'Cerejas', 63, 1.1, 16, 0.2],
      ['figos', 'Figos', 74, 0.8, 19, 0.3],
      ['dioespiro', 'Dióspiro', 70, 0.6, 18.6, 0.2],
      ['roma', 'Romã', 83, 1.7, 18.7, 1.2],
      ['maracuja', 'Maracujá', 97, 2.2, 23, 0.7],
      ['limao', 'Limão', 29, 1.1, 9.3, 0.3],
      ['avocado', 'Abacate', 160, 2, 8.5, 14.7],
      ['passas', 'Uvas-passas', 299, 3.1, 79, 0.5],
      ['tamaras', 'Tâmaras', 282, 2.5, 75, 0.4],
      ['ameixa-seca', 'Ameixas secas', 240, 2.2, 64, 0.4],
      ['coco-ralado', 'Coco ralado', 660, 6.9, 24, 64]
    ]],
    ['Frutos secos e sementes', [
      ['almonds', 'Amêndoas', 579, 21, 22, 50],
      ['walnuts', 'Nozes', 654, 15, 14, 65],
      ['amendoins', 'Amendoins torrados', 585, 24, 21, 50],
      ['cajus', 'Cajus', 553, 18, 30, 44],
      ['avelas', 'Avelãs', 628, 15, 17, 61],
      ['pistacios', 'Pistácios', 560, 20, 28, 45],
      ['castanhas', 'Castanhas assadas', 245, 3.2, 53, 2.2],
      ['peanut-butter', 'Manteiga de amendoim', 588, 25, 20, 50],
      ['tahini', 'Tahini (pasta de sésamo)', 595, 17, 21, 54],
      ['chia', 'Sementes de chia', 486, 17, 42, 31],
      ['linhaca', 'Sementes de linhaça', 534, 18, 29, 42],
      ['girassol', 'Sementes de girassol', 584, 21, 20, 51],
      ['sementes-abobora', 'Sementes de abóbora', 559, 30, 11, 49]
    ]],
    ['Gorduras e molhos', [
      ['olive-oil', 'Azeite', 884, 0, 0, 100],
      ['oleo-vegetal', 'Óleo vegetal (girassol)', 884, 0, 0, 100],
      ['oleo-coco', 'Óleo de coco', 892, 0, 0, 99],
      ['butter', 'Manteiga', 717, 0.9, 0.1, 81],
      ['margarina', 'Margarina / creme vegetal', 540, 0.2, 0.5, 60],
      ['maionese', 'Maionese', 680, 1, 0.6, 75],
      ['azeitonas', 'Azeitonas', 145, 1, 3.8, 15],
      ['ketchup', 'Ketchup', 110, 1.2, 25, 0.2],
      ['mostarda', 'Mostarda', 66, 4.4, 5.3, 3.3],
      ['polpa-tomate', 'Polpa de tomate', 30, 1.3, 5, 0.2],
      ['molho-soja', 'Molho de soja', 53, 8, 4.9, 0.6]
    ]],
    ['Doces e snacks', [
      ['acucar', 'Açúcar', 400, 0, 100, 0],
      ['honey', 'Mel', 304, 0.3, 82, 0],
      ['compota', 'Doce / compota de fruta', 250, 0.4, 62, 0.1],
      ['marmelada', 'Marmelada', 260, 0.3, 65, 0.1],
      ['creme-cacau', 'Creme de cacau e avelã', 539, 6.3, 57.5, 31],
      ['dark-chocolate', 'Chocolate negro 70%', 598, 7.8, 46, 43],
      ['chocolate-leite', 'Chocolate de leite', 535, 7.7, 59, 30],
      ['pastel-nata', 'Pastel de nata (1 ≈ 60 g)', 300, 5, 35, 15],
      ['bola-berlim', 'Bola de Berlim', 360, 6.5, 45, 17],
      ['bolo-arroz', 'Bolo de arroz', 390, 6, 52, 18],
      ['pao-de-lo', 'Pão-de-ló', 300, 8, 55, 5],
      ['salame-chocolate', 'Salame de chocolate', 430, 5, 55, 22],
      ['arroz-doce', 'Arroz-doce', 150, 3.5, 25, 4],
      ['leite-creme', 'Leite-creme', 140, 4, 20, 4.5],
      ['mousse-chocolate', 'Mousse de chocolate', 260, 5, 25, 16],
      ['gomas', 'Gomas', 340, 6, 77, 0.2],
      ['pipocas', 'Pipocas simples', 387, 13, 78, 4.5],
      ['barra-cereais', 'Barra de cereais', 400, 6, 70, 10],
      ['barra-proteica', 'Barra proteica', 360, 30, 35, 12],
      ['whey', 'Proteína whey em pó', 400, 80, 8, 6]
    ]],
    ['Pratos e petiscos', [
      ['soup-veg', 'Sopa de legumes', 40, 1.5, 6, 1.2],
      ['caldo-verde', 'Caldo verde', 55, 2.2, 5.5, 2.7],
      ['sopa-feijao', 'Sopa de feijão', 65, 3, 9, 1.8],
      ['canja', 'Canja de galinha', 45, 3, 5.5, 1],
      ['bacalhau-bras', 'Bacalhau à Brás', 190, 10, 12, 11.5],
      ['bacalhau-natas', 'Bacalhau com natas', 170, 9, 9, 11],
      ['bacalhau-gomes-sa', 'Bacalhau à Gomes de Sá', 160, 10, 10, 9],
      ['pasteis-bacalhau', 'Pastéis de bacalhau', 240, 12, 20, 12],
      ['rissois', 'Rissóis de camarão', 280, 7, 27, 16],
      ['croquetes', 'Croquetes de carne', 260, 10, 20, 15],
      ['francesinha', 'Francesinha', 230, 12, 13, 14],
      ['bifana', 'Bifana no pão', 240, 15, 25, 9],
      ['prego', 'Prego no pão', 250, 16, 24, 10],
      ['bitoque', 'Bitoque (bife, ovo e batata frita)', 210, 13, 13, 12],
      ['cozido', 'Cozido à portuguesa', 180, 13, 8, 11],
      ['feijoada', 'Feijoada à transmontana', 160, 9, 9, 10],
      ['tripas', 'Tripas à moda do Porto', 140, 10, 8, 8],
      ['porco-alentejana', 'Carne de porco à alentejana', 210, 14, 9, 13],
      ['arroz-pato', 'Arroz de pato', 190, 10, 18, 9],
      ['arroz-marisco', 'Arroz de marisco', 120, 8, 15, 3],
      ['arroz-frango', 'Arroz de frango', 150, 9, 17, 5],
      ['polvo-lagareiro', 'Polvo à lagareiro', 180, 14, 10, 9],
      ['empadao', 'Empadão de carne', 140, 7, 13, 7],
      ['lasanha', 'Lasanha de carne', 165, 9, 14, 8],
      ['bolonhesa', 'Esparguete à bolonhesa', 150, 7.5, 18, 5],
      ['caril-frango', 'Caril de frango (sem arroz)', 150, 12, 5, 9],
      ['tosta-mista', 'Tosta mista', 270, 13, 27, 12],
      ['pizza', 'Pizza de queijo', 266, 11, 33, 10],
      ['hamburguer-pao', 'Hambúrguer no pão (fast food)', 255, 13, 30, 9.5],
      ['cachorro', 'Cachorro-quente', 270, 10, 22, 16],
      ['kebab', 'Kebab no pão', 215, 12, 20, 10],
      ['nuggets', 'Nuggets de frango', 296, 15, 16, 19],
      ['sushi', 'Sushi variado', 150, 6, 26, 2.5]
    ]],
    ['Bebidas (por 100 ml)', [
      ['coffee-milk', 'Galão', 30, 1.7, 2.5, 1.3],
      ['meia-de-leite', 'Meia de leite', 25, 1.7, 2.4, 0.8],
      ['cafe', 'Café expresso', 9, 0.1, 1.7, 0.2],
      ['cha', 'Chá sem açúcar', 1, 0, 0.2, 0],
      ['orange-juice', 'Sumo de laranja natural', 45, 0.7, 10.4, 0.2],
      ['sumo-maca', 'Sumo de maçã', 46, 0.1, 11, 0.1],
      ['nectar', 'Néctar de fruta', 50, 0.2, 12, 0.1],
      ['refrigerante', 'Refrigerante com açúcar (cola, laranja)', 42, 0, 10.6, 0],
      ['refrigerante-zero', 'Refrigerante zero', 0.3, 0, 0, 0],
      ['ice-tea', 'Ice tea', 25, 0, 6, 0],
      ['energetica', 'Bebida energética', 45, 0, 11, 0],
      ['cerveja', 'Cerveja', 43, 0.5, 3.6, 0],
      ['cerveja-sem-alcool', 'Cerveja sem álcool', 22, 0.3, 4.8, 0],
      ['vinho-tinto', 'Vinho tinto', 85, 0.1, 2.6, 0],
      ['vinho-branco', 'Vinho branco', 82, 0.1, 2.6, 0],
      ['vinho-verde', 'Vinho verde', 70, 0.1, 2, 0],
      ['vinho-porto', 'Vinho do Porto', 160, 0.1, 12, 0]
    ]]
  ];
  var BUILTIN_FOODS = [];
  FOOD_GROUPS.forEach(function (g) {
    g[1].forEach(function (r) {
      BUILTIN_FOODS.push({ id: r[0], name: r[1], kcal: r[2], protein: r[3], carbs: r[4], fat: r[5], group: g[0], builtin: true });
    });
  });
  var CUSTOM_GROUP = 'Os meus alimentos';
  var BUILTIN_BY_ID = {};
  BUILTIN_FOODS.forEach(function (f) { BUILTIN_BY_ID[f.id] = f; });

  // English names the built-in foods had before the module was translated. Log
  // entries keep a copy of the name, so old ones are renamed on load.
  var OLD_NAMES = {
    'Oats (rolled)': 'oats', 'Bread, white': 'bread-white', 'Bread, wholemeal': 'bread-whole',
    'Rice, white, cooked': 'rice-cooked', 'Rice, brown, cooked': 'rice-brown-cooked', 'Pasta, cooked': 'pasta-cooked',
    'Potato, boiled': 'potato-boiled', 'Sweet potato, baked': 'sweet-potato', 'Egg (1 large ≈ 50 g)': 'egg',
    'Egg white': 'egg-white', 'Chicken breast, cooked': 'chicken-breast', 'Turkey breast, cooked': 'turkey-breast',
    'Beef mince 5% fat, cooked': 'beef-mince', 'Pork loin, cooked': 'pork-loin', 'Salmon, cooked': 'salmon',
    'Tuna, canned in water': 'tuna-can', 'Cod, cooked': 'cod', 'Sardines, canned in oil': 'sardines',
    'Tofu, firm': 'tofu', 'Chickpeas, cooked': 'chickpeas', 'Lentils, cooked': 'lentils',
    'Black beans, cooked': 'beans-black', 'Milk, semi-skimmed': 'milk-semi', 'Greek yogurt, plain 0%': 'yogurt-greek',
    'Skyr, plain': 'skyr', 'Cheese, cheddar': 'cheese-cheddar', 'Fresh cheese (queijo fresco)': 'cheese-fresh',
    'Cottage cheese': 'cottage', 'Whey protein powder': 'whey', 'Banana': 'banana', 'Apple': 'apple',
    'Orange': 'orange', 'Berries, mixed': 'berries', 'Broccoli': 'broccoli', 'Spinach': 'spinach',
    'Tomato': 'tomato', 'Lettuce / salad leaves': 'lettuce', 'Carrot': 'carrot', 'Onion': 'onion',
    'Avocado': 'avocado', 'Olive oil': 'olive-oil', 'Butter': 'butter', 'Peanut butter': 'peanut-butter',
    'Almonds': 'almonds', 'Walnuts': 'walnuts', 'Honey': 'honey', 'Dark chocolate 70%': 'dark-chocolate',
    'Ham, sliced': 'ham', 'Pizza, cheese': 'pizza', 'Vegetable soup (sopa)': 'soup-veg',
    'Orange juice': 'orange-juice', 'Coffee with milk (galão)': 'coffee-milk'
  };

  // Inject stylesheet next to this script.
  var SCRIPT_SRC = document.currentScript && document.currentScript.src;
  function ensureStyles() {
    if (!SCRIPT_SRC || document.querySelector('link[data-pdm-style]')) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = SCRIPT_SRC.replace(/[^/]*$/, 'meals.css');
    link.setAttribute('data-pdm-style', '');
    document.head.appendChild(link);
  }

  /* ---------- small helpers ---------- */

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseYmd(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(s, n) { var d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
  function today() { return ymd(new Date()); }
  function mondayOf(s) { var d = parseYmd(s); var wd = (d.getDay() + 6) % 7; return addDays(s, -wd); }
  function fmtDate(s, opts) { return parseYmd(s).toLocaleDateString(LOCALE, opts || { weekday: 'short', day: 'numeric', month: 'short' }); }
  function r0(n) { return Math.round(n || 0); }
  function r1(n) { return Math.round((n || 0) * 10) / 10; }
  function dec(n, digits) { return Number(n).toLocaleString(LOCALE, { maximumFractionDigits: digits == null ? 1 : digits }); }
  function signed(n, digits) { return (n > 0 ? '+' : n < 0 ? '−' : '') + dec(Math.abs(n), digits); }
  // Lower case without accents or punctuation, so "feijao frade" finds "Feijão-frade".
  function fold(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/[^a-z0-9%]+/g, ' ').trim();
  }
  // Every word of the query appears in the text (both already folded).
  function hasWords(text, q) {
    return q.split(' ').every(function (w) { return text.indexOf(w) !== -1; });
  }
  function num(v, dflt) { var n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : dflt; }

  // Element builder: h('div', {class: 'x', onclick: fn}, child, 'text', ...)
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
        else if (k === 'class') el.className = v;
        else if (k === 'value') el.value = v;
        else if (k === 'checked') el.checked = !!v;
        else el.setAttribute(k, v === true ? '' : v);
      });
    }
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  // Lucide icons (lucide.dev) for the icon-only buttons.
  var ICONS = {
    left: '<path d="m15 18-6-6 6-6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    minus: '<path d="M5 12h14"/>'
  };
  function icon(name) {
    var t = document.createElement('span');
    t.innerHTML = '<svg class="pdm-ic" viewBox="0 0 24 24" aria-hidden="true">' + ICONS[name] + '</svg>';
    return t.firstChild;
  }
  function append(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(function (x) { append(el, x); });
    else el.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  }

  /* ---------- data ---------- */

  function emptyState() {
    return {
      version: 1,
      goals: { kcal: 2200, protein: 140, carbs: 250, fat: 70, water: 2000 },
      customFoods: [],   // {id, name, kcal, protein, carbs, fat} per 100 g
      meals: [],         // saved meals: {id, name, items: [{foodId, grams}]}
      plan: {},          // 'YYYY-MM-DD' -> {slot: [{id, kind: 'food'|'meal'|'note', foodId, mealId, grams, text}]}
      log: {},           // 'YYYY-MM-DD' -> {slot: [{id, name, grams, kcal, protein, carbs, fat}]}
      shopping: {},      // week monday 'YYYY-MM-DD' -> {key: true} for ticked items
      water: {},         // 'YYYY-MM-DD' -> ml drunk that day
      body: {},          // 'YYYY-MM-DD' -> {weight (kg), waist, neck, hips (cm)}, any subset
      profile: { sex: '', birthYear: null, height: null, activity: 1.375, goal: 'maintain', rate: 0.5, glass: 250 }
    };
  }

  function load() {
    var s;
    try { s = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (e) { s = null; }
    if (!s || typeof s !== 'object') return emptyState();
    return upgrade(s);
  }

  // Fill missing fields and rename log entries saved with the old English food names.
  function upgrade(s) {
    var base = emptyState();
    Object.keys(base).forEach(function (k) { if (s[k] == null) s[k] = base[k]; });
    ['goals', 'profile'].forEach(function (k) {
      Object.keys(base[k]).forEach(function (f) { if (s[k][f] === undefined) s[k][f] = base[k][f]; });
    });
    Object.keys(s.log).forEach(function (date) {
      var day = s.log[date] || {};
      Object.keys(day).forEach(function (slot) {
        (day[slot] || []).forEach(function (e) {
          var id = e && OLD_NAMES.hasOwnProperty(e.name) ? OLD_NAMES[e.name] : null;
          var f = id && BUILTIN_BY_ID[id];
          if (f) e.name = f.name;
        });
      });
    });
    return s;
  }

  function save(state) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* storage blocked: keep in memory */ }
    try { window.dispatchEvent(new CustomEvent('pd:meals:change', { detail: summaryFrom(state, today()) })); } catch (e) {}
  }

  function allFoods(state) { return BUILTIN_FOODS.concat(state.customFoods); }
  function findFood(state, id) {
    var list = allFoods(state);
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function findMeal(state, id) {
    for (var i = 0; i < state.meals.length; i++) if (state.meals[i].id === id) return state.meals[i];
    return null;
  }
  function byName(list, name) {
    var n = name.trim().toLowerCase();
    for (var i = 0; i < list.length; i++) if (list[i].name.toLowerCase() === n) return list[i];
    n = fold(name);
    for (var j = 0; j < list.length; j++) if (fold(list[j].name) === n) return list[j];
    return null;
  }

  // Resolve what the user typed in a food/meal search box.
  function resolvePick(state, text) {
    text = (text || '').trim();
    if (!text) return null;
    [MEAL_PREFIX, OLD_MEAL_PREFIX].forEach(function (pre) {
      if (text.indexOf(pre) === 0 && byName(state.meals, text.slice(pre.length))) text = text.slice(pre.length);
    });
    var m2 = byName(state.meals, text);
    if (m2) return { kind: 'meal', meal: m2 };
    var f = byName(allFoods(state), text);
    if (f) return { kind: 'food', food: f };
    // Fall back to a unique partial match.
    var low = fold(text);
    var hits = allFoods(state).filter(function (x) { return fold(x.name).indexOf(low) !== -1; });
    if (hits.length === 1) return { kind: 'food', food: hits[0] };
    if (!hits.length) hits = allFoods(state).filter(function (x) { return hasWords(fold(x.name), low); });
    if (hits.length === 1) return { kind: 'food', food: hits[0] };
    return { kind: 'unknown', text: text, matches: hits.length };
  }

  function notFound(r) {
    if (r.matches > 1) return 'Há ' + r.matches + ' alimentos com "' + r.text + '". Escolhe um da lista.';
    return 'Não há nenhum alimento "' + r.text + '". Junta-o em Alimentos e refeições, ou usa Adicionar rápido.';
  }

  function macrosFor(food, grams) {
    var k = grams / 100;
    return { kcal: food.kcal * k, protein: food.protein * k, carbs: food.carbs * k, fat: food.fat * k };
  }
  function addMacros(a, b) {
    return { kcal: a.kcal + b.kcal, protein: a.protein + b.protein, carbs: a.carbs + b.carbs, fat: a.fat + b.fat };
  }
  function zero() { return { kcal: 0, protein: 0, carbs: 0, fat: 0 }; }

  function mealMacros(state, meal) {
    return meal.items.reduce(function (acc, it) {
      var f = findFood(state, it.foodId);
      return f ? addMacros(acc, macrosFor(f, it.grams)) : acc;
    }, zero());
  }

  // Log entries are snapshots, so editing a food later never rewrites history.
  function logEntryForFood(food, grams) {
    var m = macrosFor(food, grams);
    return { id: uid(), name: food.name, grams: grams, kcal: r1(m.kcal), protein: r1(m.protein), carbs: r1(m.carbs), fat: r1(m.fat) };
  }
  function logEntriesForMeal(state, meal) {
    return meal.items.map(function (it) {
      var f = findFood(state, it.foodId);
      return f ? logEntryForFood(f, it.grams) : null;
    }).filter(Boolean);
  }

  function dayLog(state, date) { return state.log[date] || {}; }
  function dayTotals(state, date) {
    var d = dayLog(state, date), t = zero();
    SLOTS.forEach(function (s) { (d[s[0]] || []).forEach(function (e) { t = addMacros(t, e); }); });
    return t;
  }
  function planEntryMacros(state, e) {
    if (e.kind === 'food') { var f = findFood(state, e.foodId); return f ? macrosFor(f, e.grams) : zero(); }
    if (e.kind === 'meal') { var m = findMeal(state, e.mealId); return m ? mealMacros(state, m) : zero(); }
    return zero();
  }
  function planEntryLabel(state, e) {
    if (e.kind === 'food') { var f = findFood(state, e.foodId); return (f ? f.name : 'Alimento desconhecido') + ' · ' + r0(e.grams) + ' g'; }
    if (e.kind === 'meal') { var m = findMeal(state, e.mealId); return m ? m.name : 'Refeição apagada'; }
    return e.text;
  }
  function dayPlanTotals(state, date) {
    var p = state.plan[date] || {}, t = zero();
    SLOTS.forEach(function (s) { (p[s[0]] || []).forEach(function (e) { t = addMacros(t, planEntryMacros(state, e)); }); });
    return t;
  }

  function summaryFrom(state, date) {
    var t = dayTotals(state, date);
    var p = state.plan[date] || {};
    var planned = [];
    SLOTS.forEach(function (s) {
      (p[s[0]] || []).forEach(function (e) { planned.push({ slot: s[0], label: planEntryLabel(state, e) }); });
    });
    return { date: date, kcal: r0(t.kcal), protein: r0(t.protein), carbs: r0(t.carbs), fat: r0(t.fat), goals: state.goals, planned: planned,
      water: waterOn(state, date), body: bodySummary(state, date) };
  }

  /* ---------- body, water and goal maths ----------
     Ideas from SparkyFitness (github.com/CodeWithCJ/SparkyFitness): water and body check-ins
     beside the food log, a goal calculator from BMR and activity, and an adaptive estimate of
     daily burn from logged intake and the weight trend. Its licence is non-commercial, so
     nothing here is copied from it; the formulas are the standard published ones. */

  var KCAL_PER_KG = 7700;   // energy in 1 kg of body weight change, the usual rule of thumb
  var ACTIVITY = [
    [1.2, 'Sedentário (trabalho sentado, pouco exercício)'],
    [1.375, 'Pouco ativo (exercício 1 a 3 dias por semana)'],
    [1.55, 'Ativo (exercício 3 a 5 dias por semana)'],
    [1.725, 'Muito ativo (exercício 6 a 7 dias por semana)'],
    [1.9, 'Extremamente ativo (treino duro e trabalho físico)']
  ];
  var GOAL_MODES = [['lose', 'Perder peso'], ['maintain', 'Manter o peso'], ['gain', 'Ganhar peso']];
  var RATES = [0.25, 0.5, 0.75, 1];

  function waterOn(state, date) { return num(state.water[date], 0); }

  // Weigh-ins as [{date, kg}] sorted by date, optionally only between two dates (inclusive).
  function weighIns(state, from, to) {
    return Object.keys(state.body).sort().filter(function (d) {
      var b = state.body[d];
      return b && b.weight > 0 && (!from || d >= from) && (!to || d <= to);
    }).map(function (d) { return { date: d, kg: state.body[d].weight }; });
  }
  function dayNumber(s) { return Math.round(parseYmd(s).getTime() / 864e5); }

  // Smoothed weight per weigh-in day: an exponential moving average that carries over the days
  // in between, so a heavy salty dinner moves it by a tenth of the jump, not the whole of it.
  function weightTrend(list) {
    var out = [], t = null, last = null;
    list.forEach(function (w) {
      if (t == null) t = w.kg;
      else t = t + (1 - Math.pow(0.9, Math.max(1, dayNumber(w.date) - last))) * (w.kg - t);
      last = dayNumber(w.date);
      out.push({ date: w.date, kg: w.kg, trend: t });
    });
    return out;
  }

  // Least-squares slope of the weigh-ins, in kg per day; null with fewer than 2 points or 7 days.
  function weightSlope(list) {
    if (list.length < 2) return null;
    var xs = list.map(function (w) { return dayNumber(w.date); });
    if (xs[xs.length - 1] - xs[0] < 7) return null;
    var n = list.length, mx = 0, my = 0;
    for (var i = 0; i < n; i++) { mx += xs[i] / n; my += list[i].kg / n; }
    var sxy = 0, sxx = 0;
    for (var j = 0; j < n; j++) { sxy += (xs[j] - mx) * (list[j].kg - my); sxx += (xs[j] - mx) * (xs[j] - mx); }
    return sxx ? sxy / sxx : null;
  }

  function latestBody(state, key, upTo) {
    var days = Object.keys(state.body).sort().reverse();
    for (var i = 0; i < days.length; i++) {
      if (upTo && days[i] > upTo) continue;
      var v = state.body[days[i]] && state.body[days[i]][key];
      if (v > 0) return { date: days[i], value: v };
    }
    return null;
  }

  // Mifflin-St Jeor resting energy, kcal/day.
  function bmr(sex, kg, cm, age) {
    if (!(kg > 0 && cm > 0 && age > 0) || (sex !== 'm' && sex !== 'f')) return null;
    return 10 * kg + 6.25 * cm - 5 * age + (sex === 'm' ? 5 : -161);
  }

  // U.S. Navy circumference method, % body fat. Women also need hips.
  function navyBodyFat(sex, cm, waist, neck, hips) {
    var log10 = Math.log10 || function (x) { return Math.log(x) / Math.LN10; };
    if (!(cm > 0 && waist > 0 && neck > 0)) return null;
    var v;
    if (sex === 'm' && waist > neck) v = 495 / (1.0324 - 0.19077 * log10(waist - neck) + 0.15456 * log10(cm)) - 450;
    else if (sex === 'f' && hips > 0 && waist + hips > neck) v = 495 / (1.29579 - 0.35004 * log10(waist + hips - neck) + 0.221 * log10(cm)) - 450;
    else return null;
    return v > 2 && v < 70 ? v : null;
  }

  function bmi(kg, cm) { return kg > 0 && cm > 0 ? kg / Math.pow(cm / 100, 2) : null; }

  // Calories and macros for a daily burn (TDEE) and the profile's goal.
  // Protein by body weight, fat at 25% of calories, carbs fill the rest. Never below a floor
  // that is commonly treated as the minimum without medical supervision.
  function targetsFor(profile, tdee, kg) {
    var delta = profile.goal === 'lose' ? -1 : profile.goal === 'gain' ? 1 : 0;
    var kcal = tdee + delta * num(profile.rate, 0.5) * KCAL_PER_KG / 7;
    var floor = profile.sex === 'f' ? 1200 : 1500;
    var floored = kcal < floor;
    kcal = Math.max(floor, kcal);
    var protein = kg * (profile.goal === 'lose' ? 2 : profile.goal === 'gain' ? 1.8 : 1.6);
    var fat = kcal * 0.25 / 9;
    var carbs = Math.max(0, (kcal - protein * 4 - fat * 9) / 4);
    var round5 = function (n) { return Math.round(n / 5) * 5; };
    return { kcal: Math.round(kcal / 10) * 10, protein: round5(protein), carbs: round5(carbs), fat: round5(fat), floored: floored };
  }

  function profileAge(profile, date) {
    var y = parseInt(profile.birthYear, 10);
    return y > 1900 ? parseYmd(date).getFullYear() - y : null;
  }

  // Burn estimated from the profile alone (BMR x activity).
  function formulaTdee(state, date) {
    var p = state.profile, w = latestBody(state, 'weight', date);
    var b = w && bmr(p.sex, w.value, num(p.height, 0), profileAge(p, date));
    return b ? { bmr: b, tdee: b * num(p.activity, 1.375), kg: w.value } : null;
  }

  // Burn estimated from what was eaten and how the weight moved over the last 28 complete days:
  // average intake minus the energy stored or lost. Needs 14 logged days and a 7-day weight span.
  var ADAPT_DAYS = 28, ADAPT_MIN_LOGGED = 14;
  function adaptiveTdee(state, date) {
    var end = addDays(date, -1), start = addDays(date, -ADAPT_DAYS);
    var logged = 0, total = 0;
    for (var d = start; d <= end; d = addDays(d, 1)) {
      var k = dayTotals(state, d).kcal;
      if (k > 0) { logged++; total += k; }
    }
    var slope = weightSlope(weighIns(state, start, end));
    var out = { logged: logged, needed: ADAPT_MIN_LOGGED, ready: false };
    if (logged < ADAPT_MIN_LOGGED || slope == null) return out;
    out.avgIntake = total / logged;
    out.kgPerWeek = slope * 7;
    out.tdee = out.avgIntake - slope * KCAL_PER_KG;
    out.ready = out.tdee > 800 && out.tdee < 6000;
    return out;
  }

  function bodySummary(state, date) {
    var list = weightTrend(weighIns(state, null, date));
    var last = list[list.length - 1];
    var slope = weightSlope(weighIns(state, addDays(date, -27), date));
    return last ? { weight: last.kg, weightDate: last.date, trend: r1(last.trend), kgPerWeek: slope == null ? null : Math.round(slope * 70) / 10 } : null;
  }

  function setWater(state, date, ml) {
    if (ml > 0) state.water[date] = Math.round(ml); else delete state.water[date];
  }
  function setBody(state, date, key, v) {
    var b = Object.assign({}, state.body[date]);
    if (v > 0) b[key] = r1(v); else delete b[key];
    if (Object.keys(b).length) state.body[date] = b; else delete state.body[date];
  }

  // Panels mounted on this page, so a change made through the module API (the Today card)
  // reaches them before they save their own copy of the data.
  var instances = [];

  /* ---------- UI ---------- */

  function mount(root, options) {
    if (!root) throw new Error('PDModules.meals.mount: missing container element');
    options = options || {};
    ensureStyles();
    var state = load();
    var view = { tab: options.tab || 'today', date: today(), week: mondayOf(today()), draft: { name: '', items: [] }, foodFilter: '', foodGroup: '', msg: '',
      bodyDate: today(), bodyRange: 90 };

    root.classList.add('pdm');

    function commit() { save(state); render(); }
    function flash(text) { view.msg = text; render(); setTimeout(function () { if (view.msg === text) { view.msg = ''; render(); } }, 2500); }

    // Two-step confirm inside the panel (window.confirm is blocked in sandboxed frames).
    function twoStep(armedLabel, action) {
      return function (ev) {
        var btn = ev.currentTarget;
        if (btn.getAttribute('data-armed')) { action(); return; }
        var orig = btn.innerHTML;
        btn.setAttribute('data-armed', '1');
        btn.classList.add('armed');
        btn.textContent = armedLabel;
        setTimeout(function () {
          if (!btn.isConnected) return;
          btn.removeAttribute('data-armed'); btn.classList.remove('armed'); btn.innerHTML = orig;
        }, 4000);
      };
    }

    function onStorage(ev) { if (ev.key === STORAGE_KEY) { state = load(); render(); } }
    window.addEventListener('storage', onStorage);
    function reload() { state = load(); render(); }
    instances.push(reload);

    function datalist(id, includeMeals) {
      var opts = [];
      if (includeMeals) state.meals.forEach(function (m) { opts.push(h('option', { value: MEAL_PREFIX + m.name })); });
      allFoods(state).forEach(function (f) { opts.push(h('option', { value: f.name })); });
      return h('datalist', { id: id }, opts);
    }

    function bar(label, val, goal, unit) {
      var pct = goal > 0 ? Math.min(100, (val / goal) * 100) : 0;
      var over = goal > 0 && val > goal * 1.05;
      return h('div', { class: 'pdm-bar' + (over ? ' over' : '') },
        h('div', { class: 'pdm-bar-head' }, h('span', null, label), h('span', { class: 'pdm-num' }, r0(val) + ' / ' + r0(goal) + ' ' + unit)),
        h('div', { class: 'pdm-track' }, h('div', { class: 'pdm-fill', style: 'width:' + pct + '%' })));
    }

    function macroLine(m) {
      return h('span', { class: 'pdm-macros', title: 'P proteína · HC hidratos de carbono · G gordura' },
        r0(m.kcal) + ' kcal · P ' + r0(m.protein) + ' · HC ' + r0(m.carbs) + ' · G ' + r0(m.fat));
    }

    /* --- Today --- */
    function renderToday() {
      var date = view.date;
      var log = dayLog(state, date);
      var plan = state.plan[date] || {};
      var t = dayTotals(state, date);
      var g = state.goals;
      var hasPlan = SLOTS.some(function (s) { return (plan[s[0]] || []).length; });

      function logPlanned(slot) {
        var entries = [];
        (plan[slot] || []).forEach(function (e) {
          if (e.kind === 'food') { var f = findFood(state, e.foodId); if (f) entries.push(logEntryForFood(f, e.grams)); }
          else if (e.kind === 'meal') { var m = findMeal(state, e.mealId); if (m) entries = entries.concat(logEntriesForMeal(state, m)); }
        });
        if (!entries.length) return 0;
        state.log[date] = state.log[date] || {};
        state.log[date][slot] = (state.log[date][slot] || []).concat(entries);
        return entries.length;
      }

      var head = h('div', { class: 'pdm-row pdm-datenav' },
        h('button', { class: 'pdm-btn ghost icon', 'aria-label': 'Dia anterior', title: 'Dia anterior', onclick: function () { view.date = addDays(view.date, -1); render(); } }, icon('left')),
        h('strong', { class: 'pdm-date' }, fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long' })),
        h('button', { class: 'pdm-btn ghost icon', 'aria-label': 'Dia seguinte', title: 'Dia seguinte', onclick: function () { view.date = addDays(view.date, 1); render(); } }, icon('right')),
        date !== today() ? h('button', { class: 'pdm-btn ghost', onclick: function () { view.date = today(); render(); } }, 'Hoje') : null,
        hasPlan ? h('button', { class: 'pdm-btn primary', onclick: function () {
          var n = 0; SLOTS.forEach(function (s) { n += logPlanned(s[0]); });
          save(state); flash(n ? n + (n > 1 ? ' itens planeados registados' : ' item planeado registado') : 'Não há nada planeado para registar');
        } }, 'Registar o plano todo') : null);

      var totals = h('div', { class: 'pdm-card pdm-totals' },
        bar('Calorias', t.kcal, g.kcal, 'kcal'),
        h('div', { class: 'pdm-grid3' }, bar('Proteína', t.protein, g.protein, 'g'), bar('Hidratos', t.carbs, g.carbs, 'g'), bar('Gordura', t.fat, g.fat, 'g')),
        h('div', { class: 'pdm-muted' }, g.kcal - t.kcal >= 0 ? 'Faltam ' + r0(g.kcal - t.kcal) + ' kcal hoje' : r0(t.kcal - g.kcal) + ' kcal acima do objetivo'));

      var slots = SLOTS.map(function (s) {
        var key = s[0];
        var items = log[key] || [];
        var st = items.reduce(addMacros, zero());
        var planned = plan[key] || [];
        var listId = 'pdm-dl-' + key;
        var pick = h('input', { class: 'pdm-input grow', list: listId, placeholder: 'Procurar alimento', 'aria-label': 'Alimento ou refeição guardada' });
        var grams = h('input', { class: 'pdm-input w-num', type: 'number', min: '0', step: '1', value: '100', 'aria-label': 'Gramas' });

        function add() {
          var r = resolvePick(state, pick.value);
          if (!r) return;
          var entries;
          if (r.kind === 'meal') entries = logEntriesForMeal(state, r.meal);
          else if (r.kind === 'food') entries = [logEntryForFood(r.food, num(grams.value, 100))];
          else { flash(notFound(r)); return; }
          state.log[date] = state.log[date] || {};
          state.log[date][key] = items.concat(entries);
          commit();
        }
        pick.addEventListener('keydown', function (e) { if (e.key === 'Enter') add(); });
        grams.addEventListener('keydown', function (e) { if (e.key === 'Enter') add(); });

        return h('section', { class: 'pdm-card pdm-slot' },
          h('div', { class: 'pdm-row spread' }, h('h3', null, s[1]), h('span', { class: 'pdm-muted pdm-num' }, r0(st.kcal) + ' kcal')),
          planned.length ? h('div', { class: 'pdm-planned' },
            h('span', { class: 'pdm-muted' }, 'Planeado: ' + planned.map(function (e) { return planEntryLabel(state, e); }).join(', ')),
            h('button', { class: 'pdm-btn small', onclick: function () { var n = logPlanned(key); save(state); flash(n ? s[1] + ' registado' : 'As notas do plano não têm valores para registar'); } }, 'Registar')) : null,
          items.length ? h('ul', { class: 'pdm-list' }, items.map(function (e) {
            return h('li', null,
              h('div', { class: 'grow' }, h('div', null, e.name, e.grams ? h('span', { class: 'pdm-muted' }, ' · ' + r0(e.grams) + ' g') : null), macroLine(e)),
              h('button', { class: 'pdm-x', 'aria-label': 'Remover ' + e.name, onclick: function () {
                state.log[date][key] = items.filter(function (x) { return x.id !== e.id; }); commit();
              } }, icon('x')));
          })) : null,
          h('div', { class: 'pdm-row' }, pick, grams, h('span', { class: 'pdm-muted' }, 'g'), h('button', { class: 'pdm-btn', onclick: add }, 'Adicionar'), datalist(listId, true)));
      });

      // Quick add for things not in the food list (restaurant meal, snack bar...).
      var qName = h('input', { class: 'pdm-input grow', placeholder: 'O que comeste?' });
      var qSlot = h('select', { class: 'pdm-input' }, SLOTS.map(function (s) { return h('option', { value: s[0] }, s[1]); }));
      var qK = h('input', { class: 'pdm-input w-num', type: 'number', min: '0', placeholder: 'kcal' });
      var qP = h('input', { class: 'pdm-input w-num', type: 'number', min: '0', placeholder: 'P g', 'aria-label': 'Proteína (g)' });
      var qC = h('input', { class: 'pdm-input w-num', type: 'number', min: '0', placeholder: 'HC g', 'aria-label': 'Hidratos (g)' });
      var qF = h('input', { class: 'pdm-input w-num', type: 'number', min: '0', placeholder: 'G g', 'aria-label': 'Gordura (g)' });
      var quick = h('details', { class: 'pdm-card' },
        h('summary', null, 'Adicionar rápido (sem procurar alimento)'),
        h('div', { class: 'pdm-row wrap' }, qName, qSlot, qK, qP, qC, qF,
          h('button', { class: 'pdm-btn primary', onclick: function () {
            if (!qName.value.trim() || !(num(qK.value, 0) > 0)) { flash('Indica um nome e as calorias'); return; }
            var slot = qSlot.value;
            state.log[date] = state.log[date] || {};
            state.log[date][slot] = (state.log[date][slot] || []).concat([{ id: uid(), name: qName.value.trim(), grams: 0,
              kcal: num(qK.value, 0), protein: num(qP.value, 0), carbs: num(qC.value, 0), fat: num(qF.value, 0) }]);
            commit();
          } }, 'Adicionar')));

      return [head, totals, renderWaterWeight(date), h('div', { class: 'pdm-slots' }, slots), quick];
    }

    /* --- Week plan --- */
    function renderPlan() {
      var wk = view.week;
      var days = [0, 1, 2, 3, 4, 5, 6].map(function (i) { return addDays(wk, i); });

      var daySel = h('select', { class: 'pdm-input', 'aria-label': 'Dia' }, days.map(function (d, i) {
        return h('option', { value: d, selected: d === view.planDay ? true : null }, DAY_NAMES[i] + ' ' + parseYmd(d).getDate());
      }));
      var slotSel = h('select', { class: 'pdm-input', 'aria-label': 'Refeição' }, SLOTS.map(function (s) {
        return h('option', { value: s[0], selected: s[0] === view.planSlot ? true : null }, s[1]);
      }));
      var pick = h('input', { class: 'pdm-input grow', list: 'pdm-dl-plan', placeholder: 'Alimento, refeição guardada ou nota (ex.: "jantar fora")' });
      var grams = h('input', { class: 'pdm-input w-num', type: 'number', min: '0', value: '100', 'aria-label': 'Gramas' });

      function add() {
        var text = pick.value.trim();
        if (!text) return;
        var r = resolvePick(state, text), e = { id: uid() };
        if (r.kind === 'meal') { e.kind = 'meal'; e.mealId = r.meal.id; }
        else if (r.kind === 'food') { e.kind = 'food'; e.foodId = r.food.id; e.grams = num(grams.value, 100); }
        else { e.kind = 'note'; e.text = text; }
        view.planDay = daySel.value; view.planSlot = slotSel.value;
        var p = state.plan[daySel.value] = state.plan[daySel.value] || {};
        p[slotSel.value] = (p[slotSel.value] || []).concat([e]);
        commit();
      }
      pick.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') add(); });

      var nav = h('div', { class: 'pdm-row pdm-datenav' },
        h('button', { class: 'pdm-btn ghost icon', 'aria-label': 'Semana anterior', title: 'Semana anterior', onclick: function () { view.week = addDays(view.week, -7); render(); } }, icon('left')),
        h('strong', { class: 'pdm-date' }, 'Semana de ' + fmtDate(wk, { day: 'numeric', month: 'long' })),
        h('button', { class: 'pdm-btn ghost icon', 'aria-label': 'Semana seguinte', title: 'Semana seguinte', onclick: function () { view.week = addDays(view.week, 7); render(); } }, icon('right')),
        wk !== mondayOf(today()) ? h('button', { class: 'pdm-btn ghost', onclick: function () { view.week = mondayOf(today()); render(); } }, 'Esta semana') : null,
        h('span', { class: 'grow' }),
        h('button', { class: 'pdm-btn ghost', onclick: function () {
          var n = 0;
          days.forEach(function (d) {
            var src = state.plan[addDays(d, -7)];
            if (!src) return;
            var copy = {};
            Object.keys(src).forEach(function (k) { copy[k] = src[k].map(function (e) { n++; return Object.assign({}, e, { id: uid() }); }); });
            state.plan[d] = copy;
          });
          if (!n) { flash('A semana passada não tem plano para copiar'); return; }
          save(state); flash('Plano da semana passada copiado');
        } }, 'Copiar semana passada'),
        h('button', { class: 'pdm-btn ghost', onclick: twoStep('Toca outra vez para limpar', function () {
          days.forEach(function (d) { delete state.plan[d]; }); commit();
        }) }, 'Limpar semana'));

      var form = h('div', { class: 'pdm-card' }, h('div', { class: 'pdm-row wrap' }, daySel, slotSel, pick, grams, h('span', { class: 'pdm-muted' }, 'g'),
        h('button', { class: 'pdm-btn primary', onclick: add }, 'Adicionar ao plano'), datalist('pdm-dl-plan', true)));

      var grid = h('div', { class: 'pdm-week' }, days.map(function (d, i) {
        var p = state.plan[d] || {};
        var tot = dayPlanTotals(state, d);
        return h('section', { class: 'pdm-card pdm-day' + (d === today() ? ' is-today' : '') },
          h('div', { class: 'pdm-row spread' }, h('h3', null, DAY_NAMES[i] + ' ' + parseYmd(d).getDate()), h('span', { class: 'pdm-muted pdm-num' }, r0(tot.kcal) + ' kcal')),
          SLOTS.map(function (s) {
            var list = p[s[0]] || [];
            if (!list.length) return null;
            return h('div', { class: 'pdm-dayslot' }, h('div', { class: 'pdm-label' }, s[1]),
              h('ul', { class: 'pdm-list tight' }, list.map(function (e) {
                return h('li', { class: e.kind === 'note' ? 'is-note' : null }, h('span', { class: 'grow' }, planEntryLabel(state, e)),
                  h('button', { class: 'pdm-x', 'aria-label': 'Remover', onclick: function () {
                    p[s[0]] = list.filter(function (x) { return x.id !== e.id; }); commit();
                  } }, icon('x')));
              })));
          }),
          !Object.keys(p).some(function (k) { return p[k].length; }) ? h('div', { class: 'pdm-muted' }, 'Nada planeado') : null);
      }));

      return [nav, form, grid, renderShopping(days)];
    }

    function renderShopping(days) {
      var wk = days[0];
      var agg = {}, notes = [];
      function addFood(id, g) { agg[id] = (agg[id] || 0) + g; }
      days.forEach(function (d) {
        var p = state.plan[d] || {};
        Object.keys(p).forEach(function (k) {
          p[k].forEach(function (e) {
            if (e.kind === 'food') addFood(e.foodId, e.grams);
            else if (e.kind === 'meal') { var m = findMeal(state, e.mealId); if (m) m.items.forEach(function (it) { addFood(it.foodId, it.grams); }); }
          });
        });
      });
      var ticks = state.shopping[wk] || {};
      var rows = Object.keys(agg).map(function (id) { var f = findFood(state, id); return { id: id, name: f ? f.name : id, grams: agg[id] }; })
        .sort(function (a, b) { return a.name.localeCompare(b.name); });
      return h('details', { class: 'pdm-card', open: rows.length ? true : null },
        h('summary', null, 'Lista de compras da semana (' + rows.length + ')'),
        rows.length ? h('ul', { class: 'pdm-list tight pdm-shop' }, rows.map(function (r) {
          return h('li', null, h('label', { class: 'grow' + (ticks[r.id] ? ' done' : '') },
            h('input', { type: 'checkbox', checked: !!ticks[r.id], onchange: function (ev) {
              state.shopping[wk] = state.shopping[wk] || {};
              state.shopping[wk][r.id] = ev.target.checked; commit();
            } }), ' ' + r.name), h('span', { class: 'pdm-muted pdm-num' }, r.grams >= 1000 ? r1(r.grams / 1000) + ' kg' : r0(r.grams) + ' g'));
        })) : h('div', { class: 'pdm-muted' }, 'Planeia alimentos ou refeições guardadas e os ingredientes aparecem aqui.'));
    }

    /* --- Foods & saved meals --- */
    function renderFoods() {
      var out = [];

      // Saved meal builder
      var d = view.draft;
      var dName = h('input', { class: 'pdm-input grow', placeholder: 'Nome da refeição, ex.: Papas de aveia', value: d.name, oninput: function (e) { d.name = e.target.value; } });
      var dPick = h('input', { class: 'pdm-input grow', list: 'pdm-dl-foods', placeholder: 'Ingrediente' });
      var dGrams = h('input', { class: 'pdm-input w-num', type: 'number', min: '0', value: '100', 'aria-label': 'Gramas' });
      function addIng() {
        var r = resolvePick(state, dPick.value);
        if (!r || r.kind !== 'food') { if (r) flash(notFound(r)); return; }
        d.items.push({ foodId: r.food.id, grams: num(dGrams.value, 100) }); render();
      }
      dPick.addEventListener('keydown', function (e) { if (e.key === 'Enter') addIng(); });
      var dm = d.items.reduce(function (a, it) { var f = findFood(state, it.foodId); return f ? addMacros(a, macrosFor(f, it.grams)) : a; }, zero());

      out.push(h('section', { class: 'pdm-card' },
        h('h3', null, d.id ? 'Editar refeição guardada' : 'Nova refeição guardada'),
        h('div', { class: 'pdm-row' }, dName),
        d.items.length ? h('ul', { class: 'pdm-list tight' }, d.items.map(function (it, i) {
          var f = findFood(state, it.foodId);
          return h('li', null, h('span', { class: 'grow' }, (f ? f.name : it.foodId) + ' · ' + r0(it.grams) + ' g'),
            h('button', { class: 'pdm-x', 'aria-label': 'Remover ingrediente', onclick: function () { d.items.splice(i, 1); render(); } }, icon('x')));
        })) : null,
        h('div', { class: 'pdm-row' }, dPick, dGrams, h('span', { class: 'pdm-muted' }, 'g'), h('button', { class: 'pdm-btn ghost', onclick: addIng }, 'Adicionar ingrediente'), datalist('pdm-dl-foods', false)),
        h('div', { class: 'pdm-row spread' }, d.items.length ? macroLine(dm) : h('span'),
          h('span', null,
            d.id ? h('button', { class: 'pdm-btn ghost', onclick: function () { view.draft = { name: '', items: [] }; render(); } }, 'Cancelar') : null,
            h('button', { class: 'pdm-btn primary', onclick: function () {
              if (!d.name.trim() || !d.items.length) { flash('Dá um nome à refeição e adiciona pelo menos um ingrediente'); return; }
              var meal = { id: d.id || uid(), name: d.name.trim(), items: d.items.slice() };
              var idx = state.meals.findIndex(function (m) { return m.id === meal.id; });
              if (idx >= 0) state.meals[idx] = meal; else state.meals.push(meal);
              view.draft = { name: '', items: [] }; commit();
            } }, 'Guardar refeição')))));

      out.push(h('section', { class: 'pdm-card' }, h('h3', null, 'Refeições guardadas'),
        state.meals.length ? h('ul', { class: 'pdm-list' }, state.meals.map(function (m) {
          return h('li', null, h('div', { class: 'grow' }, h('div', null, m.name), macroLine(mealMacros(state, m))),
            h('button', { class: 'pdm-btn small ghost', onclick: function () { view.draft = { id: m.id, name: m.name, items: m.items.slice() }; render(); } }, 'Editar'),
            h('button', { class: 'pdm-x', 'aria-label': 'Apagar ' + m.name, title: 'O que já registaste fica', onclick: twoStep('Apagar?', function () {
              state.meals = state.meals.filter(function (x) { return x.id !== m.id; }); commit();
            }) }, icon('x')));
        })) : h('div', { class: 'pdm-muted' }, 'Guarda as refeições que comes muitas vezes para as registar ou planear de uma vez.')));

      // Custom food
      var fN = h('input', { class: 'pdm-input grow', placeholder: 'Nome do alimento' });
      var fK = h('input', { class: 'pdm-input w-num', type: 'number', min: '0', placeholder: 'kcal' });
      var fP = h('input', { class: 'pdm-input w-num', type: 'number', min: '0', placeholder: 'P g', 'aria-label': 'Proteína (g)' });
      var fC = h('input', { class: 'pdm-input w-num', type: 'number', min: '0', placeholder: 'HC g', 'aria-label': 'Hidratos (g)' });
      var fF = h('input', { class: 'pdm-input w-num', type: 'number', min: '0', placeholder: 'G g', 'aria-label': 'Gordura (g)' });
      out.push(h('section', { class: 'pdm-card' }, h('h3', null, 'Adicionar alimento'),
        h('div', { class: 'pdm-muted' }, 'Valores por 100 g, do rótulo.'),
        h('div', { class: 'pdm-row wrap' }, fN, fK, fP, fC, fF, h('button', { class: 'pdm-btn primary', onclick: function () {
          var name = fN.value.trim();
          if (!name || !(num(fK.value, -1) >= 0)) { flash('Indica o nome do alimento e as calorias'); return; }
          if (byName(allFoods(state), name)) { flash('Já existe um alimento com esse nome'); return; }
          state.customFoods.push({ id: 'c-' + uid(), name: name, kcal: num(fK.value, 0), protein: num(fP.value, 0), carbs: num(fC.value, 0), fat: num(fF.value, 0) });
          commit();
        } }, 'Adicionar alimento'))));

      // Food list with filter
      var groups = [CUSTOM_GROUP].concat(FOOD_GROUPS.map(function (g) { return g[0]; }));
      var filter = h('input', { class: 'pdm-input grow', type: 'search', placeholder: 'Procurar alimentos', 'aria-label': 'Procurar alimentos', value: view.foodFilter });
      var groupSel = h('select', { class: 'pdm-input', 'aria-label': 'Categoria' },
        h('option', { value: '' }, 'Todas as categorias'),
        groups.map(function (g) { return h('option', { value: g, selected: g === view.foodGroup ? true : null }, g); }));
      var listBox = h('div');
      function drawList() {
        var q = fold(view.foodFilter);
        var rows = state.customFoods.map(function (f) { return Object.assign({ group: CUSTOM_GROUP }, f); }).concat(BUILTIN_FOODS)
          .filter(function (f) { return (!q || hasWords(fold(f.name + ' ' + f.group), q)) && (!view.foodGroup || f.group === view.foodGroup); });
        var body = [], lastGroup = null;
        rows.forEach(function (f) {
          if (f.group !== lastGroup) {
            lastGroup = f.group;
            body.push(h('tr', { class: 'pdm-group' }, h('th', { colspan: '6', scope: 'colgroup' }, f.group)));
          }
          body.push(foodRow(f));
        });
        listBox.textContent = '';
        listBox.appendChild(rows.length ? h('table', { class: 'pdm-table' },
          h('thead', null, h('tr', null, h('th', null, 'Alimento (por 100 g)'), h('th', null, 'kcal'), h('th', { title: 'Proteína' }, 'P'), h('th', { title: 'Hidratos de carbono' }, 'HC'), h('th', { title: 'Gordura' }, 'G'), h('th'))),
          h('tbody', null, body)) : h('div', { class: 'pdm-muted' }, 'Nenhum alimento encontrado. Podes juntá-lo acima.'));
      }
      function foodRow(f) {
            return h('tr', null, h('td', null, f.name), h('td', { class: 'pdm-num' }, r0(f.kcal)), h('td', { class: 'pdm-num' }, r1(f.protein)),
              h('td', { class: 'pdm-num' }, r1(f.carbs)), h('td', { class: 'pdm-num' }, r1(f.fat)),
              h('td', null, f.builtin ? null : h('button', { class: 'pdm-x', 'aria-label': 'Apagar ' + f.name, title: 'As refeições guardadas que o usam perdem esse ingrediente', onclick: twoStep('Apagar?', function () {
                state.customFoods = state.customFoods.filter(function (x) { return x.id !== f.id; }); commit();
              }) }, icon('x'))));
      }
      filter.addEventListener('input', function () { view.foodFilter = filter.value; drawList(); });
      groupSel.addEventListener('change', function () { view.foodGroup = groupSel.value; drawList(); });
      drawList();
      out.push(h('section', { class: 'pdm-card' }, h('h3', null, 'Lista de alimentos (' + (BUILTIN_FOODS.length + state.customFoods.length) + ')'),
        h('div', { class: 'pdm-row wrap' }, filter, groupSel), h('div', { class: 'pdm-scroll' }, listBox)));
      return out;
    }

    /* --- Water and weight (on the Today tab) --- */
    function renderWaterWeight(date) {
      var water = waterOn(state, date);
      var goal = num(state.goals.water, 2000);
      var glass = num(state.profile.glass, 250) || 250;
      function addWater(ml) { setWater(state, date, water + ml); commit(); }

      var b = state.body[date] || {};
      var prev = latestBody(state, 'weight', date);
      var wIn = h('input', { class: 'pdm-input w-num', type: 'number', min: '0', step: '0.1', inputmode: 'decimal', value: b.weight || '',
        placeholder: prev ? dec(prev.value) : 'kg', 'aria-label': 'Peso (kg)' });
      function saveWeight() {
        var v = num(wIn.value, 0);
        if (wIn.value.trim() && !(v > 20 && v < 400)) { flash('Indica o peso em kg, por exemplo 72,5'); return; }
        setBody(state, date, 'weight', v); commit();
      }
      wIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') saveWeight(); });
      var bs = bodySummary(state, date);

      return h('section', { class: 'pdm-card pdm-wb' },
        h('div', { class: 'pdm-stack' },
          bar('Água', water, goal, 'ml'),
          h('div', { class: 'pdm-row wrap' },
            h('button', { class: 'pdm-btn', onclick: function () { addWater(glass); } }, '+' + glass + ' ml'),
            h('button', { class: 'pdm-btn', onclick: function () { addWater(500); } }, '+500 ml'),
            water > 0 ? h('button', { class: 'pdm-btn ghost icon', 'aria-label': 'Tirar ' + glass + ' ml', title: 'Tirar ' + glass + ' ml', onclick: function () { addWater(-glass); } }, icon('minus')) : null)),
        h('div', { class: 'pdm-stack' },
          h('div', { class: 'pdm-bar-head' }, h('span', null, 'Peso'),
            h('span', { class: 'pdm-num' }, bs ? 'tendência ' + dec(bs.trend) + ' kg' + (bs.kgPerWeek != null ? ' · ' + signed(bs.kgPerWeek) + ' kg/sem' : '') : 'sem registos')),
          h('div', { class: 'pdm-row' }, wIn, h('span', { class: 'pdm-muted' }, 'kg'),
            h('button', { class: 'pdm-btn', onclick: saveWeight }, b.weight ? 'Atualizar' : 'Guardar'),
            h('button', { class: 'pdm-btn ghost', onclick: function () { view.tab = 'body'; view.bodyDate = date; render(); } }, 'Medidas'))));
    }

    /* --- Body: check-ins, weight trend, measurements --- */
    function weightChart(points, goalLine) {
      var W = 600, H = 160, P = 6;
      if (points.length < 2) return h('div', { class: 'pdm-muted' }, points.length ? 'Regista mais um dia para veres o gráfico.' : 'Ainda não há pesagens neste período.');
      var vals = [];
      points.forEach(function (p) { vals.push(p.kg, p.trend); });
      var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
      if (hi - lo < 2) { var mid = (hi + lo) / 2; lo = mid - 1; hi = mid + 1; }
      var x0 = dayNumber(points[0].date), span = Math.max(1, dayNumber(points[points.length - 1].date) - x0);
      function x(p) { return (P + (dayNumber(p.date) - x0) / span * (W - 2 * P)).toFixed(1); }
      function y(v) { return (P + (hi - v) / (hi - lo) * (H - 2 * P)).toFixed(1); }
      var line = points.map(function (p, i) { return (i ? 'L' : 'M') + x(p) + ' ' + y(p.trend); }).join(' ');
      var dots = points.map(function (p) { return '<path d="M' + x(p) + ' ' + y(p.kg) + 'h0"/>'; }).join('');
      var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">' +
        '<g class="pdm-wdots">' + dots + '</g><path class="pdm-wline" d="' + line + '"/></svg>';
      var wrap = h('div', { class: 'pdm-wchart', role: 'img', 'aria-label': 'Peso de ' + fmtDate(points[0].date) + ' a ' + fmtDate(points[points.length - 1].date) + ': de ' + dec(points[0].trend) + ' para ' + dec(points[points.length - 1].trend) + ' kg (tendência)' });
      wrap.innerHTML = svg;
      append(wrap, [
        h('span', { class: 'pdm-wlabel top' }, dec(hi) + ' kg'),
        h('span', { class: 'pdm-wlabel bottom' }, dec(lo) + ' kg')]);
      return h('div', { class: 'pdm-stack' }, wrap,
        h('div', { class: 'pdm-row spread pdm-muted' }, h('span', null, fmtDate(points[0].date, { day: 'numeric', month: 'short' })),
          h('span', { class: 'pdm-legend' }, h('i', { class: 'dot' }), 'pesagem', h('i', { class: 'ln' }), 'tendência'),
          h('span', null, fmtDate(points[points.length - 1].date, { day: 'numeric', month: 'short' }))));
    }

    function renderBody() {
      var date = view.bodyDate;
      var p = state.profile;
      var b = state.body[date] || {};
      var inputs = {};
      function measure(key, label, unit) {
        inputs[key] = h('input', { class: 'pdm-input w-num', type: 'number', min: '0', step: '0.1', inputmode: 'decimal', value: b[key] || '', 'aria-label': label + ' (' + unit + ')' });
        inputs[key].addEventListener('keydown', function (e) { if (e.key === 'Enter') saveAll(); });
        return h('label', { class: 'pdm-field' }, h('span', null, label), h('span', { class: 'pdm-row' }, inputs[key], h('span', { class: 'pdm-muted' }, unit)));
      }
      function saveAll() {
        var bad = Object.keys(inputs).filter(function (k) { var v = inputs[k].value.trim(); return v && !(num(v, 0) > 0 && num(v, 0) < 400); });
        if (bad.length) { flash('Os valores têm de ser números positivos'); return; }
        Object.keys(inputs).forEach(function (k) { setBody(state, date, k, num(inputs[k].value, 0)); });
        commit(); flash('Medições de ' + fmtDate(date) + ' guardadas');
      }

      var head = h('div', { class: 'pdm-row pdm-datenav' },
        h('button', { class: 'pdm-btn ghost icon', 'aria-label': 'Dia anterior', title: 'Dia anterior', onclick: function () { view.bodyDate = addDays(date, -1); render(); } }, icon('left')),
        h('strong', { class: 'pdm-date' }, fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long' })),
        h('button', { class: 'pdm-btn ghost icon', 'aria-label': 'Dia seguinte', title: 'Dia seguinte', onclick: function () { view.bodyDate = addDays(date, 1); render(); } }, icon('right')),
        date !== today() ? h('button', { class: 'pdm-btn ghost', onclick: function () { view.bodyDate = today(); render(); } }, 'Hoje') : null);

      // Derived numbers use the latest values up to this day.
      var w = latestBody(state, 'weight', date);
      var cm = num(p.height, 0);
      var derived = [];
      var bm = w && bmi(w.value, cm);
      if (bm) derived.push('IMC ' + dec(bm));
      var waist = latestBody(state, 'waist', date), neck = latestBody(state, 'neck', date), hips = latestBody(state, 'hips', date);
      var bf = waist && neck && navyBodyFat(p.sex, cm, waist.value, neck.value, hips && hips.value);
      if (bf) derived.push('gordura corporal ≈ ' + dec(bf) + ' % (método da Marinha dos EUA)');
      if (bf && w) derived.push('massa magra ≈ ' + dec(w.value * (1 - bf / 100)) + ' kg');
      if (waist && cm) derived.push('cintura/altura ' + dec(waist.value / cm, 2));
      var hint = !cm || !p.sex ? 'Indica o sexo e a altura em Objetivos e histórico para veres o IMC e a gordura corporal estimada.'
        : !bf ? 'Com cintura e pescoço' + (p.sex === 'f' ? ' e anca' : '') + ' estimamos a gordura corporal.' : null;

      var form = h('section', { class: 'pdm-card' }, h('h3', null, 'Medições'),
        h('div', { class: 'pdm-goals' }, measure('weight', 'Peso', 'kg'), measure('waist', 'Cintura', 'cm'), measure('neck', 'Pescoço', 'cm'), measure('hips', 'Anca', 'cm')),
        h('div', { class: 'pdm-row wrap' }, h('button', { class: 'pdm-btn primary', onclick: saveAll }, 'Guardar medições'),
          h('span', { class: 'pdm-muted' }, 'Mede a cintura à altura do umbigo e o pescoço logo abaixo da maçã de Adão, de manhã.')),
        derived.length ? h('div', { class: 'pdm-derived' }, derived.join(' · ')) : null,
        hint ? h('div', { class: 'pdm-muted' }, hint) : null);

      // Weight chart and stats over the chosen range.
      var from = addDays(today(), -(view.bodyRange - 1));
      var all = weightTrend(weighIns(state));
      var pts = all.filter(function (x) { return x.date >= from; });
      var last = all[all.length - 1];
      function changeOver(days) {
        if (!last) return null;
        var ref = null, cut = addDays(last.date, -days);
        all.forEach(function (x) { if (x.date <= cut) ref = x; });
        return ref ? last.trend - ref.trend : null;
      }
      var slope = weightSlope(weighIns(state, addDays(today(), -27), today()));
      function stat(label, value) { return h('div', { class: 'pdm-stat' }, h('span', { class: 'pdm-label' }, label), h('strong', { class: 'pdm-num' }, value)); }
      var c7 = changeOver(7), c30 = changeOver(30);
      var rangeSel = h('select', { class: 'pdm-input pdm-fit', 'aria-label': 'Período', onchange: function (e) { view.bodyRange = +e.target.value; render(); } },
        [[30, '30 dias'], [90, '90 dias'], [365, '1 ano']].map(function (o) { return h('option', { value: o[0], selected: view.bodyRange === o[0] ? true : null }, o[1]); }));
      var chart = h('section', { class: 'pdm-card' },
        h('div', { class: 'pdm-row spread' }, h('h3', null, 'Peso'), rangeSel),
        last ? h('div', { class: 'pdm-stats' },
          stat('Tendência', dec(last.trend) + ' kg'),
          stat('7 dias', c7 == null ? '—' : signed(c7) + ' kg'),
          stat('30 dias', c30 == null ? '—' : signed(c30) + ' kg'),
          stat('Ritmo (4 semanas)', slope == null ? '—' : signed(slope * 7, 2) + ' kg/sem')) : null,
        weightChart(pts),
        last ? h('div', { class: 'pdm-muted' }, 'A tendência é uma média que suaviza as variações de água e sal de um dia para o outro. Pesa-te de manhã, depois da casa de banho.') : null);

      // History table, newest first.
      var days = Object.keys(state.body).sort().reverse();
      var trendBy = {};
      all.forEach(function (x) { trendBy[x.date] = x.trend; });
      function cell(v) { return h('td', { class: 'pdm-num' }, v > 0 ? dec(v) : '—'); }
      var history = h('section', { class: 'pdm-card' }, h('h3', null, 'Histórico'),
        days.length ? h('div', { class: 'pdm-scroll' }, h('table', { class: 'pdm-table' },
          h('thead', null, h('tr', null, ['Data', 'Peso', 'Tendência', 'Cintura', 'Pescoço', 'Anca', ''].map(function (t, i) { return h('th', { class: i && t ? 'pdm-num' : null }, t); }))),
          h('tbody', null, days.map(function (d) {
            var e = state.body[d];
            return h('tr', null,
              h('td', null, h('button', { class: 'pdm-link', onclick: function () { view.bodyDate = d; render(); } }, fmtDate(d, { day: 'numeric', month: 'short', year: 'numeric' }))),
              cell(e.weight), cell(trendBy[d]), cell(e.waist), cell(e.neck), cell(e.hips),
              h('td', null, h('button', { class: 'pdm-x', 'aria-label': 'Apagar medições de ' + fmtDate(d), onclick: twoStep('Apagar?', function () { delete state.body[d]; commit(); }) }, icon('x'))));
          })))) : h('div', { class: 'pdm-muted' }, 'Ainda não registaste medições.'));

      return [head, form, chart, history];
    }

    /* --- Goal calculator (on the Goals tab) --- */
    function renderCalculator() {
      var p = state.profile;
      function set(key, v) { p[key] = v; commit(); }
      function sel(key, label, opts) {
        return h('label', { class: 'pdm-field' }, h('span', null, label),
          h('select', { class: 'pdm-input', onchange: function (e) { var v = e.target.value; set(key, /^[\d.]+$/.test(v) ? +v : v); } },
            opts.map(function (o) { return h('option', { value: o[0], selected: String(p[key]) === String(o[0]) ? true : null }, o[1]); })));
      }
      function numField(key, label, unit, min, max) {
        return h('label', { class: 'pdm-field' }, h('span', null, label),
          h('span', { class: 'pdm-row' }, h('input', { class: 'pdm-input w-num', type: 'number', min: String(min), max: String(max), value: p[key] || '', onchange: function (e) {
            var v = num(e.target.value, 0); set(key, v >= min && v <= max ? v : null);
          } }), unit ? h('span', { class: 'pdm-muted' }, unit) : null));
      }

      var d = today();
      var f = formulaTdee(state, d);
      var a = adaptiveTdee(state, d);
      var lines = [];
      if (f) lines.push(h('div', null, 'Metabolismo basal ', h('strong', { class: 'pdm-num' }, r0(f.bmr) + ' kcal'), ' · gasto diário pela fórmula ', h('strong', { class: 'pdm-num' }, r0(f.tdee) + ' kcal')));
      else lines.push(h('div', { class: 'pdm-muted' }, !latestBody(state, 'weight', d) ? 'Regista o teu peso (em Hoje ou Corpo) e preenche o perfil para calcular o gasto diário.' : 'Preenche o sexo, o ano de nascimento e a altura para calcular o gasto diário.'));
      if (a.ready) lines.push(h('div', null, 'Pelos teus registos das últimas 4 semanas comeste em média ', h('strong', { class: 'pdm-num' }, r0(a.avgIntake) + ' kcal'),
        ' e o peso variou ', h('strong', { class: 'pdm-num' }, signed(a.kgPerWeek, 2) + ' kg/sem'), ', por isso gastas cerca de ', h('strong', { class: 'pdm-num' }, r0(a.tdee) + ' kcal'), ' por dia.'));
      else lines.push(h('div', { class: 'pdm-muted' }, 'Com ' + a.needed + ' dias de refeições registados nas últimas 4 semanas e pesagens com pelo menos uma semana de intervalo, o gasto passa a ser calculado pelos teus dados reais (tens ' + a.logged + ' ' + (a.logged === 1 ? 'dia' : 'dias') + ').'));

      var base = a.ready ? a.tdee : f && f.tdee;
      var kg = (f && f.kg) || (latestBody(state, 'weight', d) || {}).value;
      var t = base && kg ? targetsFor(p, base, kg) : null;
      var g = state.goals;
      var same = t && t.kcal === g.kcal && t.protein === g.protein && t.carbs === g.carbs && t.fat === g.fat;

      return h('section', { class: 'pdm-card' }, h('h3', null, 'Calcular objetivos'),
        h('div', { class: 'pdm-goals' },
          sel('sex', 'Sexo', [['', 'Escolher'], ['m', 'Masculino'], ['f', 'Feminino']]),
          numField('birthYear', 'Ano de nascimento', '', 1920, new Date().getFullYear() - 10),
          numField('height', 'Altura', 'cm', 100, 250),
          numField('glass', 'Copo de água', 'ml', 50, 1000)),
        h('div', { class: 'pdm-goals wide' },
          sel('activity', 'Atividade', ACTIVITY),
          sel('goal', 'Objetivo', GOAL_MODES),
          p.goal !== 'maintain' ? sel('rate', 'Ritmo', RATES.map(function (r) { return [r, dec(r, 2) + ' kg por semana']; })) : null),
        h('div', { class: 'pdm-calc' }, lines),
        t ? h('div', { class: 'pdm-row wrap spread pdm-suggest' },
          h('div', null, h('div', { class: 'pdm-label' }, 'Sugestão' + (a.ready ? ' (pelos teus dados)' : ' (pela fórmula)')),
            h('div', { class: 'pdm-num' }, t.kcal + ' kcal · P ' + t.protein + ' g · HC ' + t.carbs + ' g · G ' + t.fat + ' g'),
            t.floored ? h('div', { class: 'pdm-muted' }, 'Não sugerimos menos de ' + (p.sex === 'f' ? 1200 : 1500) + ' kcal por dia; um ritmo mais lento chega lá com segurança.') : null),
          h('button', { class: 'pdm-btn primary', disabled: same ? true : null, onclick: function () {
            g.kcal = t.kcal; g.protein = t.protein; g.carbs = t.carbs; g.fat = t.fat; commit(); flash('Objetivos atualizados');
          } }, same ? 'Já estás a usar esta sugestão' : 'Usar estes objetivos')) : null,
        h('div', { class: 'pdm-muted' }, 'Proteína de 1,6 a 2 g por kg de peso, gordura a 25 % das calorias e hidratos no resto. São estimativas: ajusta pelo que vês na balança ao fim de 2 a 3 semanas.'));
    }

    /* --- Goals & data --- */
    function renderGoals() {
      var g = state.goals;
      function field(key, label, unit) {
        return h('label', { class: 'pdm-field' }, h('span', null, label),
          h('span', { class: 'pdm-row' }, h('input', { class: 'pdm-input w-num', type: 'number', min: '0', value: g[key], onchange: function (e) {
            g[key] = Math.max(0, num(e.target.value, g[key])); commit();
          } }), h('span', { class: 'pdm-muted' }, unit)));
      }

      // Last 7 days of totals
      var days = [6, 5, 4, 3, 2, 1, 0].map(function (i) { return addDays(today(), -i); });
      var maxK = Math.max(g.kcal, Math.max.apply(null, days.map(function (d) { return dayTotals(state, d).kcal; }))) || 1;
      var chart = h('div', { class: 'pdm-chart', role: 'img', 'aria-label': 'Calorias nos últimos 7 dias' },
        h('div', { class: 'pdm-goal-line', style: 'bottom:calc(20px + (100% - 20px) * ' + (g.kcal / maxK).toFixed(3) + ')' }),
        days.map(function (d) {
          var k = dayTotals(state, d).kcal;
          return h('div', { class: 'pdm-col', title: fmtDate(d) + ': ' + r0(k) + ' kcal' },
            h('div', { class: 'pdm-colbar' + (k > g.kcal * 1.05 ? ' over' : ''), style: 'height:' + (k / maxK * 100) + '%' }),
            h('div', { class: 'pdm-collabel' }, DAY_NAMES[(parseYmd(d).getDay() + 6) % 7]));
        }));
      var logged = days.filter(function (d) { return dayTotals(state, d).kcal > 0; });
      var avg = logged.length ? logged.reduce(function (a, d) { return a + dayTotals(state, d).kcal; }, 0) / logged.length : 0;

      function importText(text) {
        try {
          var s = JSON.parse(text);
          if (!s || s.version !== 1 || !s.log) throw new Error('bad');
          state = upgrade(s);
          save(state); flash('Cópia de segurança restaurada');
        } catch (err) { flash('Isso não é uma cópia de segurança das refeições'); }
      }
      var fileIn = h('input', { type: 'file', accept: 'application/json,.json', class: 'pdm-hidden', onchange: function (e) {
        var file = e.target.files[0]; if (!file) return;
        var rd = new FileReader();
        rd.onload = function () { importText(rd.result); };
        rd.readAsText(file);
      } });
      // Backups also go through a text box, since downloads can be blocked where the dashboard is hosted.
      var backupBox = h('textarea', { class: 'pdm-input pdm-backup', rows: '4', spellcheck: 'false', placeholder: 'O texto exportado aparece aqui. Para restaurar, cola aqui uma cópia e carrega em Restaurar a partir do texto.', 'aria-label': 'Texto da cópia de segurança' });

      return [
        h('section', { class: 'pdm-card' }, h('h3', null, 'Últimos 7 dias'), chart,
          h('div', { class: 'pdm-muted' }, logged.length ? 'Média de ' + r0(avg) + ' kcal em ' + logged.length + (logged.length > 1 ? ' dias registados' : ' dia registado') + ' · objetivo ' + r0(g.kcal) : 'Ainda não há dias registados')),
        h('section', { class: 'pdm-card' }, h('h3', null, 'Objetivos diários'),
          h('div', { class: 'pdm-goals' }, field('kcal', 'Calorias', 'kcal'), field('protein', 'Proteína', 'g'), field('carbs', 'Hidratos de carbono', 'g'), field('fat', 'Gordura', 'g'), field('water', 'Água', 'ml'))),
        renderCalculator(),
        h('section', { class: 'pdm-card' }, h('h3', null, 'Os teus dados'),
          h('div', { class: 'pdm-muted' }, 'Guardados neste browser (e na tua conta, com sessão iniciada). Exporta uma cópia para teres um backup.'),
          h('div', { class: 'pdm-row wrap' },
            h('button', { class: 'pdm-btn ghost', onclick: function () {
              var json = JSON.stringify(state);
              backupBox.value = json; backupBox.focus(); backupBox.select();
              var copied = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(json) : Promise.reject();
              copied.then(function () { view.msg = 'Copiado. Cola num sítio seguro, como uma nota.'; },
                function () { view.msg = 'A cópia está na caixa abaixo. Seleciona tudo e copia.'; })
                .then(function () { var m = root.querySelector('.pdm-msg'); if (m) m.textContent = view.msg; else root.insertBefore(h('div', { class: 'pdm-msg', role: 'status' }, view.msg), root.querySelector('.pdm-body')); });
            } }, 'Exportar como texto'),
            h('button', { class: 'pdm-btn ghost', onclick: function () {
              try {
                var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
                var a = h('a', { href: URL.createObjectURL(blob), download: 'refeicoes-backup-' + today() + '.json' });
                document.body.appendChild(a); a.click(); a.remove();
              } catch (e) { flash('As transferências estão bloqueadas aqui. Usa Exportar como texto.'); }
            } }, 'Transferir ficheiro'),
            h('button', { class: 'pdm-btn ghost', onclick: function () { fileIn.click(); } }, 'Importar ficheiro'), fileIn,
            h('button', { class: 'pdm-btn ghost danger', onclick: twoStep('Toca outra vez para apagar tudo', function () {
              state = emptyState(); commit();
            }) }, 'Apagar tudo')),
          backupBox,
          h('div', { class: 'pdm-row' }, h('button', { class: 'pdm-btn ghost', onclick: function () {
            if (!backupBox.value.trim()) { flash('Cola primeiro uma cópia na caixa'); return; }
            importText(backupBox.value.trim());
          } }, 'Restaurar a partir do texto')))];
    }

    function render() {
      var tabs = [['today', 'Hoje'], ['plan', 'Plano semanal'], ['foods', 'Alimentos e refeições'], ['body', 'Corpo'], ['goals', 'Objetivos e histórico']];
      var body = view.tab === 'plan' ? renderPlan() : view.tab === 'foods' ? renderFoods() : view.tab === 'body' ? renderBody()
        : view.tab === 'goals' ? renderGoals() : renderToday();
      root.textContent = '';
      append(root, [
        options.hideTitle ? null : h('h2', { class: 'pdm-title' }, 'Refeições'),
        h('nav', { class: 'pdm-tabs', role: 'tablist' }, tabs.map(function (t) {
          return h('button', { role: 'tab', 'aria-selected': view.tab === t[0] ? 'true' : 'false', class: 'pdm-tab', onclick: function () { view.tab = t[0]; render(); } }, t[1]);
        })),
        view.msg ? h('div', { class: 'pdm-msg', role: 'status' }, view.msg) : null,
        h('div', { class: 'pdm-body' }, body)
      ]);
      // The tab strip is rebuilt on every render and scrolls on a phone: bring the open tab into view.
      var on = root.querySelector('.pdm-tab[aria-selected="true"]');
      if (on) {
        var bar = on.parentNode, gap = on.getBoundingClientRect().right - bar.getBoundingClientRect().right;
        if (gap > 0) bar.scrollLeft = gap + 24;
      }
    }

    render();

    return {
      unmount: function () {
        window.removeEventListener('storage', onStorage);
        instances = instances.filter(function (f) { return f !== reload; });
        root.textContent = ''; root.classList.remove('pdm');
      },
      refresh: function () { state = load(); render(); },
      summary: function (date) { return summaryFrom(state, date || today()); }
    };
  }

  // Compact read-out for the dashboard's Today page: calories and macros against goals,
  // water with a one-tap glass, and the weight trend. Redraw it whenever the day or data changes.
  function todayCard(el, date, opts) {
    ensureStyles();
    opts = opts || {};
    var state = load();
    var t = dayTotals(state, date), g = state.goals;
    var water = waterOn(state, date), glass = num(state.profile.glass, 250) || 250;
    var bs = bodySummary(state, date);
    function mini(label, val, goal) {
      var pct = goal > 0 ? Math.min(100, val / goal * 100) : 0;
      return h('div', { class: 'pdm-bar' + (goal > 0 && val > goal * 1.05 ? ' over' : '') },
        h('div', { class: 'pdm-bar-head' }, h('span', null, label), h('span', null, r0(val) + '/' + r0(goal))),
        h('div', { class: 'pdm-track' }, h('div', { class: 'pdm-fill', style: 'width:' + pct + '%' })));
    }
    el.classList.add('pdm', 'pdm-todaycard');
    el.textContent = '';
    append(el, [
      h('div', { class: 'pdm-bar' + (t.kcal > g.kcal * 1.05 ? ' over' : '') },
        h('div', { class: 'pdm-bar-head' }, h('span', null, 'Calorias'), h('span', null, r0(t.kcal) + ' / ' + r0(g.kcal) + ' kcal')),
        h('div', { class: 'pdm-track' }, h('div', { class: 'pdm-fill', style: 'width:' + (g.kcal > 0 ? Math.min(100, t.kcal / g.kcal * 100) : 0) + '%' }))),
      h('div', { class: 'pdm-grid3 tight' }, mini('Proteína', t.protein, g.protein), mini('Hidratos', t.carbs, g.carbs), mini('Gordura', t.fat, g.fat)),
      h('div', { class: 'pdm-row' },
        h('div', { class: 'grow' }, h('div', { class: 'pdm-bar' + (water >= num(g.water, 2000) ? ' done' : '') },
          h('div', { class: 'pdm-bar-head' }, h('span', null, 'Água'), h('span', null, r0(water) + ' / ' + r0(num(g.water, 2000)) + ' ml')),
          h('div', { class: 'pdm-track' }, h('div', { class: 'pdm-fill water', style: 'width:' + Math.min(100, water / (num(g.water, 2000) || 1) * 100) + '%' })))),
        h('button', { class: 'pdm-btn small', 'aria-label': 'Beber um copo (' + glass + ' ml)', onclick: function () {
          window.PDModules.meals.addWater(glass, date);
          if (opts.onChange) opts.onChange();
        } }, '+' + glass + ' ml')),
      h('div', { class: 'pdm-row spread pdm-muted' },
        h('span', null, bs ? 'Peso ' + dec(bs.trend) + ' kg' + (bs.kgPerWeek != null ? ' · ' + signed(bs.kgPerWeek) + ' kg/sem' : '') : 'Sem pesagens ainda'),
        opts.onOpen ? h('button', { class: 'pdm-link pdm-muted', onclick: opts.onOpen }, 'Abrir Refeições') : null)
    ]);
  }

  window.PDModules = window.PDModules || {};
  window.PDModules.meals = {
    id: 'meals',
    title: 'Refeições',
    storageKey: STORAGE_KEY,
    mount: mount,
    // Today's totals and plan without mounting the UI (for a dashboard overview card).
    summary: function (date) { return summaryFrom(load(), date || today()); },
    // Add (or with a negative number remove) water for a day, from outside the panel.
    addWater: function (ml, date) {
      var state = load(), d = date || today();
      setWater(state, d, waterOn(state, d) + ml);
      save(state);
      instances.forEach(function (f) { f(); });
    },
    glassSize: function () { return num(load().profile.glass, 250) || 250; },
    todayCard: todayCard,
    // Pure maths, exposed for tests.
    calc: { bmr: bmr, navyBodyFat: navyBodyFat, bmi: bmi, targetsFor: targetsFor, weightTrend: weightTrend, weightSlope: weightSlope }
  };
})();

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
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'
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
      goals: { kcal: 2200, protein: 140, carbs: 250, fat: 70 },
      customFoods: [],   // {id, name, kcal, protein, carbs, fat} per 100 g
      meals: [],         // saved meals: {id, name, items: [{foodId, grams}]}
      plan: {},          // 'YYYY-MM-DD' -> {slot: [{id, kind: 'food'|'meal'|'note', foodId, mealId, grams, text}]}
      log: {},           // 'YYYY-MM-DD' -> {slot: [{id, name, grams, kcal, protein, carbs, fat}]}
      shopping: {}       // week monday 'YYYY-MM-DD' -> {key: true} for ticked items
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
    return { date: date, kcal: r0(t.kcal), protein: r0(t.protein), carbs: r0(t.carbs), fat: r0(t.fat), goals: state.goals, planned: planned };
  }

  /* ---------- UI ---------- */

  function mount(root, options) {
    if (!root) throw new Error('PDModules.meals.mount: missing container element');
    options = options || {};
    ensureStyles();
    var state = load();
    var view = { tab: options.tab || 'today', date: today(), week: mondayOf(today()), draft: { name: '', items: [] }, foodFilter: '', foodGroup: '', msg: '' };

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

      return [head, totals, h('div', { class: 'pdm-slots' }, slots), quick];
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

    /* --- Goals & data --- */
    function renderGoals() {
      var g = state.goals;
      function field(key, label, unit) {
        return h('label', { class: 'pdm-field' }, h('span', null, label),
          h('span', { class: 'pdm-row' }, h('input', { class: 'pdm-input w-num', type: 'number', min: '0', value: g[key], onchange: function (e) {
            g[key] = Math.max(0, num(e.target.value, g[key])); save(state);
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
          h('div', { class: 'pdm-goals' }, field('kcal', 'Calorias', 'kcal'), field('protein', 'Proteína', 'g'), field('carbs', 'Hidratos de carbono', 'g'), field('fat', 'Gordura', 'g'))),
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
      var tabs = [['today', 'Hoje'], ['plan', 'Plano semanal'], ['foods', 'Alimentos e refeições'], ['goals', 'Objetivos e histórico']];
      var body = view.tab === 'plan' ? renderPlan() : view.tab === 'foods' ? renderFoods() : view.tab === 'goals' ? renderGoals() : renderToday();
      root.textContent = '';
      append(root, [
        options.hideTitle ? null : h('h2', { class: 'pdm-title' }, 'Refeições'),
        h('nav', { class: 'pdm-tabs', role: 'tablist' }, tabs.map(function (t) {
          return h('button', { role: 'tab', 'aria-selected': view.tab === t[0] ? 'true' : 'false', class: 'pdm-tab', onclick: function () { view.tab = t[0]; render(); } }, t[1]);
        })),
        view.msg ? h('div', { class: 'pdm-msg', role: 'status' }, view.msg) : null,
        h('div', { class: 'pdm-body' }, body)
      ]);
    }

    render();

    return {
      unmount: function () { window.removeEventListener('storage', onStorage); root.textContent = ''; root.classList.remove('pdm'); },
      refresh: function () { state = load(); render(); },
      summary: function (date) { return summaryFrom(state, date || today()); }
    };
  }

  window.PDModules = window.PDModules || {};
  window.PDModules.meals = {
    id: 'meals',
    title: 'Refeições',
    storageKey: STORAGE_KEY,
    mount: mount,
    // Today's totals and plan without mounting the UI (for a dashboard overview card).
    summary: function (date) { return summaryFrom(load(), date || today()); }
  };
})();

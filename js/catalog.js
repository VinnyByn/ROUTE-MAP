// Catálogo de materiais e preços: nomes da planilha, preços padrão, kits, configurações de lançamento
// e mão de obra da empresa, janela do catálogo, importação da planilha (Excel/Google Sheets/API).
// Depende de script.js (bomState, projectBoms, showAlert, showToast) e js/supabase-client.js.

//Nomes antigos do sistema → nomes da planilha de preços da empresa.
//O código continua usando os nomes antigos internamente (tipos de cabo, splitters…);
//tudo que vira material (preço, lista de materiais, catálogo, relatórios) passa pelo nome novo.
const MATERIAL_RENAMES = {
    "SUPORTE ANCORAGEM PARA CABOS OPTICOS (SUPAS)": "SUPORTE ANCORAGEM PARA CABOS OPTICOS (SUPA)",
    "RESERVA OPTILOOP": "RESERVA OPTILOOP (RAQUETE)",
    "DERIVAÇÃO EM T": "ALÇA PREFORMADA DERIVAÇÃO EM T",
    "FITA DE AÇO INOX 3/4'' (FITA FUSIMEC) ROLO DE 25M": "FITA DE AÇO INOX 3/4\" (FITA FUSIMEC) ROLO DE 25M",
    "PLAQUETA DE IDENTIFICAÇÃO": "PLAQUETA DE IDENTIFICAÇÃO DE CABOS",
    "ALÇA PREFORMADA OPDE 1007 - 12,8MM A 14,2MM": "ALÇA PREFORMADA OPDE 1007 - 12,8mm a 14,2mm",
    "ARAME DE ESPIMAR (105 m)": "ARAME DE ESPINAR (BOBINA DE 105M)",
    "PRENSA DE ESPINAR": "PRENÇA PARA ESPINAR",
    "CABO DROP FLAT LOW FRICTION 1F": "DROP FLAT 1FO",
    "Cabo AS 80 FO-06": "CFOA SM ASU 80 S 06 FIBRAS NR",
    "Cabo AS 80 FO-12": "CFOA SM ASU 80 S 12 FIBRAS NR",
    "Cabo AS 80 FO-24": "CFOA SM AS 80 S 24 FIBRAS NR KP",
    "Cabo AS 80 FO-36": "CFOA SM AS 80 S 36 FIBRAS NR KP",
    "Cabo AS 80 FO-48": "CFOA SM AS 80 S 48 FIBRAS NR KP",
    "Cabo AS 80 FO-72": "CFOA SM AS 80 S 72 FIBRAS NR KP",
    "Cabo AS 80 FO-144": "CFOA SM AS 80 S 144 FIBRAS NR KP",
    "Cabo AS 200 FO-12": "CFOA SM AS 200 S 12 FIBRAS NR KP",
    "Cabo AS 200 FO-24": "CFOA SM AS 200 S 24 FIBRAS NR KP",
    "Cabo AS 200 FO-36": "CFOA SM AS 200 S 36 FIBRAS NR KP",
    "CAIXA DE ATENDIMENTO": "CTO FIBERSUL",
    "CAIXA DE EMENDA OPTICA (CEO) 144 FUSÕES": "CAIXAS DE EMENDA OPTICA DE 144 FIBRAS",
    "CAIXA DE EMENDA ÓPTICA (CEO)": "CAIXAS DE FUSÃO - 24F (EXPANSIVA)",
    "Splitter 1/2": "SPLITTER FUSÃO 1/2",
    "Splitter 1/4": "SPLITTER FUSÃO 1/4",
    "Splitter 1/8": "SPLITTER FUSÃO 1/8",
    "Splitter 1/8 APC": "SPLITTER CONECTORIZADO 1/8 SC/APC",
    "Splitter 1/8 UPC": "SPLITTER CONECTORIZADO 1/8 SC/UPC",
    "Splitter 1/16 APC": "SPLITTER CONECTORIZADO 1/16 SC/APC",
    "Splitter 1/16 UPC": "SPLITTER CONECTORIZADO 1/16 SC/UPC",
    "KIT DE BANDEJA PARA CAIXA DE EMENDA": "KIT DE BANDEJA PARA CAIXA TIPO FOSC - 24F",
    "KIT DERIVAÇÃO PARA CAIXA DE EMENDA OPTICA": "KIT DERIVAÇÃO PARA CAIXA DE EMENDA ÓPTICA",
    "PTO - PONTO DE TERMINAÇÃO ÓPTICA": "PONTO DE TERMINAÇÃO ÓPTICA (PTO)",
    "CAIXA DE ATENDIMENTO PREDIAL": "CAIXA DE TERMINAÇÃO ÓPTICA PREDIAL",
    "CONECTOR DE CAMPO SC/APC": "CONECTOR PRÉ-POLIDO",
    "RODIZIO RP50 PL50X67 - KIT 4 PEÇAS": "KIT RODIZIO DE 4 PEÇAS COM 4 RODAS PARA RACK IPMETAL 60X60CM RP50 PL50X67",
    "KIT PORCA GAIOLA + PARAFUSO": "PORCA GAIOLA + PARAFUSO",
    "ROLO VELCRO DE 3 METROS PARA ORGANIZAR CABOS": "ROLO VELCRO 3M PARA ORGANIZAR CABOS",
    "DGO 144 SC/APC COM PIGTAILS COR PRETA": "DIO DE 144 POSIÇÕES SC/APC COM PIGTAILS COR PRETA",
    "CORDÃO ÓPTICO SIMPLEX MONOMODO SC/UPC > SC/APC 2m": "CORDÕES SC-PC/ SC-APC",
    "CORDÃO ÓPTICO DUPLEX MULTIMODO LC/UPC > LC/UPC OM3 2M": "CORDÃO ÓPTICO DUPLEX MULTIMODO LC/UPC - LC/UPC 2m",
    "CORDÃO ÓPTICO DUPLEX MONOMODO LC/UPC > SC/APC 2M": "CORDÃO ÓPTICO DUPLEX MONOMODO LC/UPC - SC/APC 2m",
    "PATCHCORD CAT6 AZUL 1,5M": "PATCHCORD MAXITELECOM CAT6 1,5m",
    "SFP 1270NM TX/1330NM RX 20KM, 10G, BIDI": "SFP+ (1270nm TX/1330nm RX 20Km, 10G, BIDI)",
    "SFP 1330NM TX/1270NM RX 20KM, 10G, BIDI": "SFP+ (1330nm TX/1270nm RX 20Km, 10G, BIDI)",
    "SFP 850NM 10G 0,3KM MULTIMODO DUPLEX": "SFP (MULTIMODO, 10G, DUPLEX)",
    "FONTE INVERSORA 48VCC/110VCA 600W": "INVERSOR 48VCC/110VCA 600W - XPS",
    "AR CONDICIONADO SPLIT HI WALL LG DUAL INVERTER 12000 BTUS FRIO 220V": "AR CONDICIONADO SPLIT HI WALL LG DUAL INVERTER 12000 BTUs FRIO"
};

function resolveMaterialName(name) {
    return MATERIAL_RENAMES[name] || name;
}

//Banco de dados de preços e materiais (chaves com os nomes da planilha; aceita também os antigos)
const MATERIAL_PRICES_BASE = {
    //Define itens que, ao serem adicionados, inserem automaticamente subcomponentes na BOM
    "CTO": {
        price: 0,
        unit: 'un',
        components: [
            { name: "CAIXA DE ATENDIMENTO", quantity: 1 },
            { name: "ABRAÇADEIRA DE NYLON", quantity: 4 },
            { name: "ANEL GUIA", quantity: 4 },
            { name: "FECHO DENTADO PARA FITA DE AÇO INOX 3/4", quantity: 2 }
        ]
    },

    //Componentes passivos de fusão
    "CAIXA DE ATENDIMENTO": { price: 92.29, unit: 'un', category: 'Fusão' },
    //Diferenciação de preços entre conectores
    "Splitter 1/2": { price: 28.91, unit: 'un', category: 'Fusão' },
    "Splitter 1/4": { price: 29.00, unit: 'un', category: 'Fusão' },
    "Splitter 1/8": { price: 38.90, unit: 'un', category: 'Fusão' },
    "Splitter 1/16": { price: 49.90, unit: 'un', category: 'Fusão' },
    "Splitter 1/2 APC": { price: 31.89, unit: 'un', category: 'Fusão' },
    "Splitter 1/4 APC": { price: 38.50, unit: 'un', category: 'Fusão' },
    "Splitter 1/8 APC": { price: 55.00, unit: 'un', category: 'Fusão' },
    "Splitter 1/16 APC": { price: 94.00, unit: 'un', category: 'Fusão' },
    "Splitter 1/2 UPC": { price: 30.30, unit: 'un', category: 'Fusão' },
    "Splitter 1/4 UPC": { price: 37.00, unit: 'un', category: 'Fusão' },
    "Splitter 1/8 UPC": { price: 42.00, unit: 'un', category: 'Fusão' },
    "Splitter 1/16 UPC": { price: 86.84, unit: 'un', category: 'Fusão' },
    "TUBETE PROTETOR DE EMENDA OPTICA": { price: 0.08, unit: 'un', category: 'Fusão' },
    "ADAPTADOR SC/APC COM ABAS (PASSANTE)": { price: 1.10, unit: 'un', category: 'Fusão' },
    "ADAPTADOR SC/UPC COM ABAS (PASSANTE)": { price: 1.10, unit: 'un', category: 'Fusão' },
    "ADAPTADOR SC/APC SEM ABAS (PASSANTE)": { price: 0.89, unit: 'un', category: 'Fusão' },
    "ADAPTADOR SC/UPC SEM ABAS (PASSANTE)": { price: 0.89, unit: 'un', category: 'Fusão' },
    "KIT DERIVAÇÃO PARA CAIXA DE EMENDA OPTICA": { price: 14.40, unit: 'un', category: 'Fusão' },
    "FITA ISOLANTE": { price: 5.10, unit: 'un', category: 'Fusão' },
    "KIT DE BANDEJA PARA CAIXA DE EMENDA": { price: 16.54, unit: 'un', category: 'Fusão' },
    "CAIXA DE ATENDIMENTO PREDIAL": { price: 85.59, unit: 'un', category: 'Fusão' }, //
    //Ferragens de poste e sustentação
    "ABRAÇADEIRA DE NYLON": { price: 0.22, unit: 'un', category: 'Ferragem' },
    "ANEL GUIA": { price: 0.75, unit: 'un', category: 'Ferragem' },
    "FECHO DENTADO PARA FITA DE AÇO INOX 3/4": { price: 0.44, unit: 'un', category: 'Ferragem' },
    "FITA DE AÇO INOX 3/4'' (FITA FUSIMEC) ROLO DE 25M": { price: 51.80, unit: 'un', category: 'Ferragem' },
    "PLAQUETA DE IDENTIFICAÇÃO": { price: 1.17, unit: 'un', category: 'Ferragem' },
    "SUPORTE DIELETRICO DUPLO": { price: 9.00, unit: 'un', category: 'Ferragem' },
    "PARAFUSO M12X35 - SEM PORCA": { price: 0.65, unit: 'un', category: 'Ferragem' },
    "SUPORTE REFORÇADO HORIZONTAL PARA BAP": { price: 2.50, unit: 'un', category: 'Ferragem' },
    "SUPORTE ANCORAGEM PARA CABOS OPTICOS (SUPAS)": { price: 9.51, unit: 'un', category: 'Ferragem' },
    "ALÇA PREFORMADA OPDE 1008 - 6,8mm a 7,4mm": { price: 2.29, unit: 'un', category: 'Ferragem' },
    "ALÇA PREFORMADA OPDE 1020 - 9,0mm a 9,8mm": { price: 5.91, unit: 'un', category: 'Ferragem' },
    "ALÇA PREFORMADA OPDE 1021 - 9,6mm a 10,4mm": { price: 8.40, unit: 'un', category: 'Ferragem' },
    "ABRAÇADEIRA BAP 3": { price: 16.08, unit: 'un', category: 'Ferragem' },
    //Caixa de emenda e acessórios
    "CAIXA DE EMENDA ÓPTICA (CEO)": { price: 186.29, unit: 'un', category: 'Fusão' },
    "CAIXA DE EMENDA OPTICA (CEO) 144 FUSÕES": { price: 265, unit: 'un', category: 'Fusão' },
    "SUPORTE PARA CEO": { price: 16.92, unit: 'un', category: 'Ferragem' },
    "RAQUETE PARA CEO": { price: 37.00, unit: 'un', category: 'Ferragem' },
    "TAP BRACKET": { price: 9.21, unit: 'un', category: 'Ferragem' },
    "ARAME DE ESPIMAR (105 m)": { price: 22.00, unit: 'un', category: 'Ferragem' },
    "PRENSA DE ESPINAR": { price: 2.73, unit: 'un', category: 'Ferragem' },
    "ALÇA PREFORMADA PARA CORDOALHA 3/16 POL": { price: 3.19, unit: 'un', category: 'Ferragem' },
    "FITA DE AMARRAÇÃO INOX 16 POL": { price: 2.48, unit: 'un', category: 'Ferragem' },
    "SUPORTE PRESBOW (REX)": { price: 15.68, unit: 'un', category: 'Ferragem' },
    "ISOLADOR ROLDANA": { price: 9.50, unit: 'un', category: 'Ferragem' },
    "KIT DERIVAÇÃO POR CABO": { price: 14.40, unit: 'un', category: 'Fusão' },
    "DERIVAÇÃO EM T": { price: 3.95, unit: 'un', category: 'Ferragem' },
    "CABO DE AÇO CORDOALHA 3/16 POL": { price: 3.29, unit: 'm', category: 'Ferragem' },
    //Marcadores lógicos
    "RESERVA": { price: 0, unit: 'un', category: 'Ferragem' },
    "CASA": { price: 0.00, unit: 'un', category: 'Atendimento' },
    //Atendimento ao cliente (drop e acessórios do kit de instalação)
    "CABO DROP FLAT LOW FRICTION 1F": { price: 0.55, unit: 'm', category: 'Lançamento' },
    "CONECTOR DE CAMPO SC/APC": { price: 3.90, unit: 'un', category: 'Fusão' },
    "ESTICADOR PARA CABO DROP": { price: 1.20, unit: 'un', category: 'Ferragem' },
    "PTO - PONTO DE TERMINAÇÃO ÓPTICA": { price: 6.50, unit: 'un', category: 'Fusão' },
    //Equipamentos ativos
    "PLACA": { price: 0, unit: 'un', category: 'Data Center'},
    "CORDÃO ÓPTICO SIMPLEX MONOMODO SC/UPC > SC/APC 2m": { price: 6.90, unit: 'un', category: 'Data Center'},
    "CHASSI OLT C650 ZTE": { price: 2598.40, unit: 'un', category: 'Data Center'},
    "LICENÇA OLT": { price: 5043.00, unit: 'un', category: 'Data Center'},
    "MÓDULO DE ENERGIA DC C650-C600 PARA OLT ZTE": { price: 659.43, unit: 'un', category: 'Data Center'},
    "PLACA CONTROLADORA E SWITCHING C600/C650": { price: 6056.20, unit: 'un', category: 'Data Center'},
    "SFP 1270NM TX/1330NM RX 20KM, 10G, BIDI": { price: 140, unit: 'un', category: 'Data Center' },
    "SFP 1330NM TX/1270NM RX 20KM, 10G, BIDI": { price: 140, unit: 'un', category: 'Data Center' },
    "XFP 850NM 10G 0,3KM MULTIMODO DUPLEX": { price: 249, unit: 'un', category: 'Data Center' },
    "RACK INDOOR IPMETAL 44U 800X1000MM / PRETO / PORTA DIANTEIRA PERFURADO E TRASEIRA BI-PARTIDA PERFURADO / CALHA LATERAL": { price: 4736.38, unit: 'un', category: 'Data Center' },
    "RODIZIO RP50 PL50X67 - KIT 4 PEÇAS": { price: 99.69, unit: 'un', category: 'Data Center' },
    "BANDEJA DE VENTILAÇÃO DE TETO PARA RACK IPMETAL 44U 1000MM": { price: 388.08, unit: 'un', category: 'Data Center' },
    "GUIA DE CABO 1U EM ABS COR PRETA": { price: 16.62, unit: 'un', category: 'Data Center' },
    "KIT PORCA GAIOLA + PARAFUSO": { price: 0.80, unit: 'un', category: 'Data Center' },
    "RÉGUA DE TOMADA 2P+T 10A, CABO DE 2,5M COM BITOLA 1,5MM² / SEM FUSÍVEL E DISJUNTOR": { price: 125.09, unit: 'un', category: 'Data Center' },
    "ROLO VELCRO DE 3 METROS PARA ORGANIZAR CABOS": { price: 8.55, unit: 'un', category: 'Data Center' },
    "DGO 144 SC/APC COM PIGTAILS COR PRETA": { price: 3671.13, unit: 'un', category: 'Data Center' },
    "CAIXA DE EMENDA OPTICA FIBRACEM 216F JUMBO SVM COM REENTRADA DIAMETRO 13 A 18MM": { price: 265, unit: 'un', category: 'Data Center' },
    "KIT DE DERIVAÇÃO SVM PARA CEO 144F GROMMET (2 ENTRADAS 7 A 13MM)": { price: 15.61, unit: 'un', category: 'Data Center' },
    "ALÇA PREFORMADA OPDE 1007 - 12,8MM A 14,2MM": { price: 10.2, unit: 'un', category: 'Data Center' },
    "SUPORTE REX ARMAÇÃO SECUNDÁRIA 1X1 PRESBOW 4,8 MM": { price: 12.54, unit: 'un', category: 'Data Center' },
    "ISOLADOR ROLDANA 72X72 PORCELANA": { price: 7.33, unit: 'un', category: 'Data Center' },
    "BRAÇADEIRA BAP 3": { price: 12.06, unit: 'un', category: 'Data Center' },
    "RESERVA OPTILOOP": { price: 36.5, unit: 'un', category: 'Data Center' },
    "CABO DE AÇO CORDOALHA 3/16 POL D": { price: 3.29, unit: 'm', category: 'Data Center' },
    "ALÇA PREFORMADA PARA CORDOALHA 3/16 (4,8MM)": { price: 3.68, unit: 'un', category: 'Data Center' },
    "CORDÃO ÓPTICO DUPLEX MULTIMODO LC/UPC > LC/UPC OM3 2M": { price: 41.9, unit: 'un', category: 'Data Center' },
    "CORDÃO ÓPTICO DUPLEX MONOMODO LC/UPC > SC/APC 2M": { price: 17.9, unit: 'un', category: 'Data Center' },
    "PATCHCORD CAT6 AZUL 1,5M": { price: 29.9, unit: 'un', category: 'Data Center' },
    "PATCHCORD CAT6 AZUL 2,5M": { price: 45.9, unit: 'un', category: 'Data Center' },
    "PLACA OLT LINE ANYPON 16 PORTS CARD (HFTH)": { price: 5545, unit: 'un', category: 'Data Center' },
    "MÓDULO SFP C+ PARA PLACA OLT LINE ANYPON ZTE": { price: 300.08, unit: 'un', category: 'Data Center' },
    "SWITCH MPLS 24 PORTAS": { price: 24538.31, unit: 'un', category: 'Data Center' },
    "SFP 850NM 10G 0,3KM MULTIMODO DUPLEX": { price: 50.43, unit: 'un', category: 'Data Center' },
    "SFP GBIC ELÉTRICO": { price: 92.17, unit: 'un', category: 'Data Center' },
    "FONTE RETIFICADORA 48VCC / 100A ~ 200A": { price: 11580, unit: 'un', category: 'Data Center' },
    "BATERIA DE LÍTIO 100A FB100B3 ZTE": { price: 6660, unit: 'un', category: 'Data Center' },
    "FONTE INVERSORA 48VCC/110VCA 600W": { price: 2324, unit: 'un', category: 'Data Center' },
    "VALOR ESTIMADO COM MATERIAIS ELÉTRICOS, DISJUNTORES, QDC, CABOS, ILUMINAÇÃO, ETC,.": { price: 6500, unit: 'un', category: 'Data Center' },
    "PRESTAÇÃO DE SERVIÇO ELETRICISTA": { price: 6000, unit: 'un', category: 'Data Center' },
    "AR CONDICIONADO SPLIT HI WALL LG DUAL INVERTER 12000 BTUS FRIO 220V": { price: 3196, unit: 'un', category: 'Data Center' },
    "PRESTAÇÃO DE SERVIÇO INSTALAÇÃO AR CONDICIONADO": { price: 900, unit: 'un', category: 'Data Center' },
    "CAMERA DE MONITORAMENTO IP INTELBRAS VIP 1220 B G3": { price: 339, unit: 'un', category: 'Data Center' },
    "MÉDIA DE ALUGUEL MENSAL": { price: 900, unit: 'un', category: 'Data Center' },

    //CAbos AS 80 e AS 200
    "CABO ÓPTICO AS 80 S 144 FIBRAS NR KP": { price: 10.80, unit: 'm', category: 'Data Center' },
    "Cabo AS 80 FO-06": { price: 1.66, unit: 'm', category: 'Lançamento' },
    "Cabo AS 200 FO-06": { price: 2.08, unit: 'm', category: 'Lançamento' },
    "Cabo AS 80 FO-12": { price: 2.02, unit: 'm', category: 'Lançamento' },
    "Cabo AS 200 FO-12": { price: 2.53, unit: 'm', category: 'Lançamento' },
    "Cabo AS 80 FO-24": { price: 3.26, unit: 'm', category: 'Lançamento' },
    "Cabo AS 200 FO-24": { price: 4.08, unit: 'm', category: 'Lançamento' },
    "Cabo AS 80 FO-36": { price: 3.93, unit: 'm', category: 'Lançamento' },
    "Cabo AS 200 FO-36": { price: 4.91, unit: 'm', category: 'Lançamento' },
    "Cabo AS 80 FO-48": { price: 5.10, unit: 'm', category: 'Lançamento' },
    "Cabo AS 200 FO-48": { price: 6.38, unit: 'm', category: 'Lançamento' },
    "Cabo AS 80 FO-72": { price: 5.32, unit: 'm', category: 'Lançamento' },
    "Cabo AS 200 FO-72": { price: 6.65, unit: 'm', category: 'Lançamento' },
    "Cabo AS 80 FO-144": { price: 10.80, unit: 'm', category: 'Lançamento' },
    "Cabo AS 200 FO-144": { price: 13.50, unit: 'm', category: 'Lançamento' },
    //Mão de obra
    "Mão de Obra Regional": { price: 320.00, unit: 'un', category: 'Mão de Obra' }, // Custo por técnico/dia (8h * R$40/h)
    "Mão de Obra Terceirizada": { price: 0, unit: 'un', category: 'Mão de Obra' }
};
//Materiais do sistema que não estão na planilha de preços da empresa: saem do catálogo e dos preços
//(se algum cálculo ainda usar, aparece na lista de materiais sem preço)
const MATERIALS_NOT_IN_SHEET = [
    "Splitter 1/16",
    "Splitter 1/2 APC",
    "Splitter 1/4 APC",
    "Splitter 1/2 UPC",
    "Splitter 1/4 UPC",
    "ADAPTADOR SC/APC SEM ABAS (PASSANTE)",
    "SUPORTE REFORÇADO HORIZONTAL PARA BAP",
    "RAQUETE PARA CEO",
    "SUPORTE PRESBOW (REX)",
    "ISOLADOR ROLDANA",
    "KIT DERIVAÇÃO POR CABO",
    "ESTICADOR PARA CABO DROP",
    "CHASSI OLT C650 ZTE",
    "LICENÇA OLT",
    "MÓDULO DE ENERGIA DC C650-C600 PARA OLT ZTE",
    "PLACA CONTROLADORA E SWITCHING C600/C650",
    "XFP 850NM 10G 0,3KM MULTIMODO DUPLEX",
    "RACK INDOOR IPMETAL 44U 800X1000MM / PRETO / PORTA DIANTEIRA PERFURADO E TRASEIRA BI-PARTIDA PERFURADO / CALHA LATERAL",
    "BANDEJA DE VENTILAÇÃO DE TETO PARA RACK IPMETAL 44U 1000MM",
    "RÉGUA DE TOMADA 2P+T 10A, CABO DE 2,5M COM BITOLA 1,5MM² / SEM FUSÍVEL E DISJUNTOR",
    "CAIXA DE EMENDA OPTICA FIBRACEM 216F JUMBO SVM COM REENTRADA DIAMETRO 13 A 18MM",
    "KIT DE DERIVAÇÃO SVM PARA CEO 144F GROMMET (2 ENTRADAS 7 A 13MM)",
    "BRAÇADEIRA BAP 3",
    "CABO DE AÇO CORDOALHA 3/16 POL D",
    "ALÇA PREFORMADA PARA CORDOALHA 3/16 (4,8MM)",
    "PATCHCORD CAT6 AZUL 2,5M",
    "PLACA OLT LINE ANYPON 16 PORTS CARD (HFTH)",
    "MÓDULO SFP C+ PARA PLACA OLT LINE ANYPON ZTE",
    "SWITCH MPLS 24 PORTAS",
    "SFP GBIC ELÉTRICO",
    "FONTE RETIFICADORA 48VCC / 100A ~ 200A",
    "BATERIA DE LÍTIO 100A FB100B3 ZTE",
    "VALOR ESTIMADO COM MATERIAIS ELÉTRICOS, DISJUNTORES, QDC, CABOS, ILUMINAÇÃO, ETC,.",
    "PRESTAÇÃO DE SERVIÇO ELETRICISTA",
    "PRESTAÇÃO DE SERVIÇO INSTALAÇÃO AR CONDICIONADO",
    "CAMERA DE MONITORAMENTO IP INTELBRAS VIP 1220 B G3",
    "MÉDIA DE ALUGUEL MENSAL",
    "CABO ÓPTICO AS 80 S 144 FIBRAS NR KP",
    "Cabo AS 200 FO-06",
    "Cabo AS 200 FO-48",
    "Cabo AS 200 FO-72",
    "Cabo AS 200 FO-144",
];
MATERIALS_NOT_IN_SHEET.forEach(name => { delete MATERIAL_PRICES_BASE[name]; });
//Itens retirados que têm equivalente na planilha: kits e cálculos passam a usar o item da planilha
//Itens da planilha usados pelos kits (preço da planilha; atualizado pelo botão "Atualizar pela API")
Object.assign(MATERIAL_PRICES_BASE, {
    "Rack Indoor": { price: 499.69, unit: 'un', category: 'Data Center' },
    "BANDEJA DE VENTILAÇÃO DE TETO PARA RACK SERVIDOR IPMETAL 60X60CM 2 VENT. 600 MM BI-VOLT PT": { price: 141.83, unit: 'un', category: 'Data Center' },
    "CALHA DE TOMADA PARA RACK 19\" COM 12 TOMADAS - 10A ( 2T+P, CABO DE 2,5m COM BITOLA 2,5mm²)": { price: 85.6, unit: 'un', category: 'Data Center' },
    "CAIXA DE EMENDA ÓPTICA FIST GCO2 B 144 FUSÕES": { price: 209.72, unit: 'un', category: 'Fusão' },
    "KIT DERIVAÇÃO PARA CAIXA FIST 144FO CS2279-000 -GCO2-16": { price: 17.23, unit: 'un', category: 'Fusão' },
    "CHASSI OLT - NA 5516": { price: 16050, unit: 'un', category: 'Data Center' },
    "PLACA EC16B - FIBERHOME": { price: 13375, unit: 'un', category: 'Data Center' },
    "SWITCH HUAWEI 6720 48P": { price: 23005, unit: 'un', category: 'Data Center' },
    "FONTE 48VCC 30A - XPS": { price: 5155.26, unit: 'un', category: 'Data Center' },
    "BATERIAS ESTACIONÁRIAS - 12V/70AH UNIPOWER": { price: 875.54, unit: 'un', category: 'Data Center' },
});
const MATERIAL_SUBSTITUTES = {
    "RAQUETE PARA CEO": "RESERVA OPTILOOP (RAQUETE)",
    "SUPORTE PRESBOW (REX)": "SUPORTE REX ARMAÇÃO SECUNDÁRIA 1X1 PRESBOW 4,8 MM",
    "ISOLADOR ROLDANA": "ISOLADOR ROLDANA 72X72 PORCELANA",
    "BRAÇADEIRA BAP 3": "ABRAÇADEIRA BAP 3",
    "CABO DE AÇO CORDOALHA 3/16 POL D": "CABO DE AÇO CORDOALHA 3/16 POL",
    "ALÇA PREFORMADA PARA CORDOALHA 3/16 (4,8MM)": "ALÇA PREFORMADA PARA CORDOALHA 3/16 POL",
    "CABO ÓPTICO AS 80 S 144 FIBRAS NR KP": "CFOA SM AS 80 S 144 FIBRAS NR KP",
    "PATCHCORD CAT6 AZUL 2,5M": "PATCHCORD MAXITELECOM CAT6 1,5m",
    "ADAPTADOR SC/APC SEM ABAS (PASSANTE)": "ADAPTADOR SC/APC COM ABAS (PASSANTE)",
    "Splitter 1/2 APC": "SPLITTER FUSÃO 1/2",
    "Splitter 1/2 UPC": "SPLITTER FUSÃO 1/2",
    "Splitter 1/4 APC": "SPLITTER FUSÃO 1/4",
    "Splitter 1/4 UPC": "SPLITTER FUSÃO 1/4",
    "Splitter 1/16": "SPLITTER CONECTORIZADO 1/16 SC/APC",
    "KIT DERIVAÇÃO POR CABO": "KIT DERIVAÇÃO PARA CAIXA DE EMENDA ÓPTICA",
    "CAIXA DE EMENDA OPTICA FIBRACEM 216F JUMBO SVM COM REENTRADA DIAMETRO 13 A 18MM": "CAIXA DE EMENDA ÓPTICA FIST GCO2 B 144 FUSÕES",
    "KIT DE DERIVAÇÃO SVM PARA CEO 144F GROMMET (2 ENTRADAS 7 A 13MM)": "KIT DERIVAÇÃO PARA CAIXA FIST 144FO CS2279-000 -GCO2-16",
    "CHASSI OLT C650 ZTE": "CHASSI OLT - NA 5516",
    "PLACA OLT LINE ANYPON 16 PORTS CARD (HFTH)": "PLACA EC16B - FIBERHOME",
    "SWITCH MPLS 24 PORTAS": "SWITCH HUAWEI 6720 48P",
    "FONTE RETIFICADORA 48VCC / 100A ~ 200A": "FONTE 48VCC 30A - XPS",
    "BATERIA DE LÍTIO 100A FB100B3 ZTE": "BATERIAS ESTACIONÁRIAS - 12V/70AH UNIPOWER",
    "RACK INDOOR IPMETAL 44U 800X1000MM / PRETO / PORTA DIANTEIRA PERFURADO E TRASEIRA BI-PARTIDA PERFURADO / CALHA LATERAL": "Rack Indoor",
    "BANDEJA DE VENTILAÇÃO DE TETO PARA RACK IPMETAL 44U 1000MM": "BANDEJA DE VENTILAÇÃO DE TETO PARA RACK SERVIDOR IPMETAL 60X60CM 2 VENT. 600 MM BI-VOLT PT",
    "RÉGUA DE TOMADA 2P+T 10A, CABO DE 2,5M COM BITOLA 1,5MM² / SEM FUSÍVEL E DISJUNTOR": "CALHA DE TOMADA PARA RACK 19\" COM 12 TOMADAS - 10A ( 2T+P, CABO DE 2,5m COM BITOLA 2,5mm²)",
    "XFP 850NM 10G 0,3KM MULTIMODO DUPLEX": "SFP (MULTIMODO, 10G, DUPLEX)",
};
Object.assign(MATERIAL_RENAMES, MATERIAL_SUBSTITUTES);
//Itens retirados sem equivalente na planilha: saem dos kits e da lista de materiais
//(os tipos de cabo sem preço continuam, porque são a metragem dos cabos desenhados)
const MATERIALS_DROPPED_SET = new Set(MATERIALS_NOT_IN_SHEET
    .filter(name => !(name in MATERIAL_SUBSTITUTES) && !/^Cabo AS /.test(name))
    .map(name => String(name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()));

function isDroppedMaterial(name) {
    return MATERIALS_DROPPED_SET.has(String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim());
}

//Componentes de kit com os nomes da planilha, sem os itens retirados
function normalizeKitComponents(components) {
    const merged = [];
    (components || []).forEach(c => {
        const name = resolveMaterialName(String(c.name || '').trim());
        if (!name || isDroppedMaterial(name)) return;
        const existing = merged.find(m => m.name === name);
        if (existing) existing.quantity += Number(c.quantity) || 1;
        else merged.push({ name, quantity: Number(c.quantity) || 1 });
    });
    return merged;
}
const MATERIALS_NOT_IN_SHEET_SET = new Set(MATERIALS_NOT_IN_SHEET.map(name => String(name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()));
Object.keys(MATERIAL_RENAMES).forEach(oldName => {
    if (!(oldName in MATERIAL_PRICES_BASE)) return;
    const newName = MATERIAL_RENAMES[oldName];
    if (!(newName in MATERIAL_PRICES_BASE)) MATERIAL_PRICES_BASE[newName] = MATERIAL_PRICES_BASE[oldName];
    delete MATERIAL_PRICES_BASE[oldName];
});
const materialPriceKey = (key) => (typeof key === 'string' ? resolveMaterialName(key) : key);
const MATERIAL_PRICES = new Proxy(MATERIAL_PRICES_BASE, {
    get: (target, key) => target[materialPriceKey(key)],
    set: (target, key, value) => { target[materialPriceKey(key)] = value; return true; },
    has: (target, key) => materialPriceKey(key) in target,
    deleteProperty: (target, key) => delete target[materialPriceKey(key)],
});

/* =====================================================================
   CADASTRO DE MATERIAIS E KITS
   - Catálogo editável pela interface (nome, categoria, unidade, preço
     unitário e fornecedor) com kits (conjuntos de materiais).
   - Salvo por empresa no Supabase (tabela company_settings) e semeado a
     partir do MATERIAL_PRICES. Só o administrador pode alterar.
   ===================================================================== */
//Chaves antigas: o catálogo ficava só no navegador. Usadas uma vez para
//levar os preços existentes para a empresa (ver loadCompanySettings).
const LEGACY_CATALOG_STORAGE_KEY = 'routeMapMaterialCatalog_v1';
const LEGACY_LANCAMENTO_STORAGE_KEY = 'routeMapLancamentoConfig_v1';

//Estado em memória do catálogo
let materialCatalog = { materials: [], kits: [] };

const DEFAULT_LANCAMENTO_CONFIG = {
    poleSpan: 35,        //Distância padrão entre postes (m)
    plaquetaPerPole: 1,  //Plaquetas por poste
    bapPerPole: 1,       //Abraçadeiras BAP por poste
    supaPerPole: 2,      //Suportes de ancoragem (SUPAS) por poste
    alcaPerSupa: 1,      //Alças preformadas por SUPA
    dropSlack: 15        //Metros somados a cada drop de cliente (subida, reserva e acomodação)
};

const DEFAULT_LABOR_CONFIG = {
    hourlyRate: 40,      //Custo por técnico/hora (R$)
    hoursPerDay: 8,
    cablePerDay: 2000,   //Metros de cabo lançados por dia
    ctoPerDay: 10,
    ceoPerDay: 1
};

//Configuração do lançamento (vão entre postes e ferragens por poste)
let lancamentoConfig = { ...DEFAULT_LANCAMENTO_CONFIG };
//Custo e produtividade da mão de obra regional
let laborConfig = { ...DEFAULT_LABOR_CONFIG };

function normalizeLancamentoConfig(stored) {
    const src = stored || {};
    const n = (value, fallback) => (value != null && Number.isFinite(Number(value)) ? Number(value) : fallback);
    return {
        poleSpan: Number(src.poleSpan) > 0 ? Number(src.poleSpan) : DEFAULT_LANCAMENTO_CONFIG.poleSpan,
        plaquetaPerPole: n(src.plaquetaPerPole, DEFAULT_LANCAMENTO_CONFIG.plaquetaPerPole),
        bapPerPole: n(src.bapPerPole, DEFAULT_LANCAMENTO_CONFIG.bapPerPole),
        supaPerPole: n(src.supaPerPole, DEFAULT_LANCAMENTO_CONFIG.supaPerPole),
        alcaPerSupa: n(src.alcaPerSupa, DEFAULT_LANCAMENTO_CONFIG.alcaPerSupa),
        dropSlack: n(src.dropSlack, DEFAULT_LANCAMENTO_CONFIG.dropSlack)
    };
}

function normalizeLaborConfig(stored) {
    const src = stored || {};
    const positive = (value, fallback) => (Number(value) > 0 ? Number(value) : fallback);
    return {
        hourlyRate: Number(src.hourlyRate) >= 0 && src.hourlyRate != null ? Number(src.hourlyRate) : DEFAULT_LABOR_CONFIG.hourlyRate,
        hoursPerDay: positive(src.hoursPerDay, DEFAULT_LABOR_CONFIG.hoursPerDay),
        cablePerDay: positive(src.cablePerDay, DEFAULT_LABOR_CONFIG.cablePerDay),
        ctoPerDay: positive(src.ctoPerDay, DEFAULT_LABOR_CONFIG.ctoPerDay),
        ceoPerDay: positive(src.ceoPerDay, DEFAULT_LABOR_CONFIG.ceoPerDay)
    };
}

//Dias estimados de obra a partir dos quantitativos do projeto
function estimateLaborDays(quantities) {
    return Math.ceil(
        (quantities.cableLength / laborConfig.cablePerDay)
        + (quantities.ctoCount / laborConfig.ctoPerDay)
        + (quantities.ceoCount / laborConfig.ceoPerDay)
    );
}

function readLegacyLocalSetting(key) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
}

//Grava campos em company_settings (somente administrador)
let companySettingsSaveChain = Promise.resolve();
function saveCompanySettings(patch) {
    if (!AppSession.isAdmin) return Promise.resolve(false);
    companySettingsSaveChain = companySettingsSaveChain.then(async () => {
        const { error } = await supabaseClient
            .from('company_settings')
            .upsert({ company_id: AppSession.company.id, ...patch }, { onConflict: 'company_id' });
        if (error) {
            console.error('Erro ao salvar configurações da empresa:', error);
            showAlert('Erro', 'Não foi possível salvar as alterações da empresa no banco de dados.');
            return false;
        }
        return true;
    });
    return companySettingsSaveChain;
}

function persistLancamentoConfig() {
    return saveCompanySettings({ lancamento_config: lancamentoConfig, labor_config: laborConfig });
}

//Carrega catálogo e configurações da empresa após o login
async function loadCompanySettings() {
    const { data, error } = await supabaseClient
        .from('company_settings')
        .select('material_catalog, lancamento_config, labor_config')
        .eq('company_id', AppSession.company.id)
        .maybeSingle();
    if (error) {
        console.error('Erro ao carregar configurações da empresa:', error);
        showAlert('Aviso', 'Não foi possível carregar os preços da empresa. Os valores padrão estão sendo usados.');
        return;
    }
    let storedCatalog = data?.material_catalog || null;
    let storedLancamento = data?.lancamento_config || null;
    const storedLabor = data?.labor_config || null;
    //Primeiro acesso do admin: aproveita o catálogo que estava salvo neste navegador
    let importedLegacy = false;
    if (!storedCatalog && AppSession.isAdmin) {
        const legacyCatalog = readLegacyLocalSetting(LEGACY_CATALOG_STORAGE_KEY);
        if (legacyCatalog && Array.isArray(legacyCatalog.materials)) {
            storedCatalog = legacyCatalog;
            storedLancamento = storedLancamento || readLegacyLocalSetting(LEGACY_LANCAMENTO_STORAGE_KEY);
            importedLegacy = true;
        }
    }
    loadMaterialCatalog(storedCatalog);
    lancamentoConfig = normalizeLancamentoConfig(storedLancamento);
    laborConfig = normalizeLaborConfig(storedLabor);
    applyCatalogToMaterialPrices();
    if (AppSession.isAdmin && (!data?.material_catalog || importedLegacy)) {
        await saveCompanySettings({
            material_catalog: materialCatalog,
            lancamento_config: lancamentoConfig,
            labor_config: laborConfig
        });
    }
    applyCatalogPermissions();
    try { syncCatalogPricesIntoBoms(); } catch (e) { /* sem listas calculadas ainda */ }
    await addMissingSheetMaterials();
    await loadSheetKits();
}

//Kits POP, OLT e placa vindos da planilha de kits (kits.json, gerado no deploy).
//Os itens e valores do kit são os da planilha; materiais que não existem no catálogo são adicionados.
const SHEET_KIT_SOURCE = 'planilha-kits';

async function loadSheetKits() {
    let data;
    try {
        const response = await fetch(`kits.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!response.ok) return;
        data = await response.json();
    } catch (e) {
        return;
    }
    const sheetKits = data?.kits || {};
    if (!Object.keys(sheetKits).length) return;
    const known = new Set(materialCatalog.materials.map(m => normalizeMaterialName(m.name)));
    const knownCodes = new Set(materialCatalog.materials.map(m => String(m.code || '').trim()).filter(Boolean));
    //Nomes antigos do sistema (em qualquer grafia) que já viraram um material da planilha de preços
    //(as trocas por aproximação não contam: a planilha de kits usa o item original)
    const renamedNorms = new Set(Object.keys(MATERIAL_RENAMES).filter(k => !(k in MATERIAL_SUBSTITUTES)).map(normalizeMaterialName));
    let changed = false;
    Object.entries(sheetKits).forEach(([kitName, items]) => {
        const components = (items || [])
            .filter(i => i.descricao && Number(i.quantidade) > 0)
            .map(i => ({
                name: String(i.descricao).trim(),
                quantity: Number(i.quantidade),
                unit: normalizeImportUnit(i.unidade),
                price: Number(i.valor_unitario) || 0,
                code: String(i.codigo || '').trim(),
            }));
        if (!components.length) return;
        components.forEach(c => {
            const norm = normalizeMaterialName(c.name);
            if (known.has(norm) || renamedNorms.has(norm) || (c.code && knownCodes.has(c.code))) return;
            materialCatalog.materials.push({
                id: generateCatalogId('mat'),
                name: c.name,
                category: 'Data Center',
                unit: c.unit,
                price: c.price,
                supplier: '',
                code: c.code,
                notes: 'Da planilha de kits',
            });
            known.add(norm);
            changed = true;
        });
        const existing = materialCatalog.kits.find(k => k.name.toUpperCase() === kitName.toUpperCase());
        const signature = JSON.stringify(components);
        if (existing && JSON.stringify(existing.components) === signature && existing.source === SHEET_KIT_SOURCE) return;
        if (existing) {
            existing.components = components;
            existing.source = SHEET_KIT_SOURCE;
            existing.category = 'Data Center';
        } else {
            materialCatalog.kits.push({ id: generateCatalogId('kit'), name: kitName, category: 'Data Center', components, source: SHEET_KIT_SOURCE });
        }
        changed = true;
    });
    if (!changed) return;
    applyCatalogToMaterialPrices();
    if (document.getElementById('materialCatalogModal')?.style.display === 'flex') renderCatalog();
    if (AppSession.isAdmin) persistMaterialCatalog();
}

//Adiciona um kit à lista de materiais com os valores do próprio kit (planilha de kits)
function addKitToBom(kitName, multiplier = 1) {
    getKitComponents(kitName).forEach(item => {
        const qty = (Number(item.quantity) || 0) * multiplier;
        if (qty > 0) addMaterialToBom(item.name, qty, Number.isFinite(item.price) ? item.price : undefined);
    });
}

function hasSheetKit(kitName) {
    return materialCatalog.kits.some(k => k.name.toUpperCase() === kitName.toUpperCase() && k.source === SHEET_KIT_SOURCE && k.components.length);
}

//Completa o catálogo com os itens da planilha de preços que ainda não existem no sistema
//(código, unidade e valor da planilha; o que já existe não é alterado)
async function addMissingSheetMaterials() {
    let data;
    try {
        const response = await fetch(`materiais.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!response.ok) return;
        data = await response.json();
    } catch (e) {
        return; //Sem o arquivo (ex.: rodando localmente): fica como está
    }
    const known = new Set(materialCatalog.materials.map(m => normalizeMaterialName(m.name)));
    const knownCodes = new Set(materialCatalog.materials.map(m => String(m.code || '').trim()).filter(c => c && c !== '?'));
    let added = 0;
    let sectionsChanged = false;
    (data?.itens || []).forEach(item => {
        const name = String(item.descricao || '').trim();
        const price = Number(item.valor_unitario);
        const code = String(item.codigo || '').trim();
        if (!name || !Number.isFinite(price)) return;
        const norm = normalizeMaterialName(name);
        const aliasTarget = SHEET_MATERIAL_ALIASES[norm];
        const section = String(item.secao || '').trim();
        //Material que já existe: guarda a seção da planilha (define a categoria)
        const targetNorm = aliasTarget ? normalizeMaterialName(resolveMaterialName(aliasTarget)) : norm;
        const existing = materialCatalog.materials.find(m => normalizeMaterialName(m.name) === targetNorm || normalizeMaterialName(m.name) === norm);
        if (existing) {
            if (section && existing.section !== section) { existing.section = section; sectionsChanged = true; }
            return;
        }
        if (known.has(norm)) return;
        if (code && code !== '?' && knownCodes.has(code) && materialCatalog.materials.some(m => m.code === code && normalizeMaterialName(m.name) === norm)) return;
        materialCatalog.materials.push({
            id: generateCatalogId('mat'),
            name,
            category: classifyPriceSheetCategory(name),
            unit: normalizeImportUnit(item.unidade),
            price,
            supplier: '',
            code: code === '?' ? '' : code,
            notes: 'Da planilha de preços',
            section,
        });
        known.add(norm);
        added++;
    });
    if (!added && !sectionsChanged) return;
    applyCatalogToMaterialPrices();
    populateCatalogCategoryFilters?.();
    if (document.getElementById('materialCatalogModal')?.style.display === 'flex') renderCatalog();
    if (AppSession.isAdmin) persistMaterialCatalog();
}

//Esconde as ações de edição do catálogo para quem não é admin
function applyCatalogPermissions() {
    const readOnly = !AppSession.isAdmin;
    document.body.classList.toggle('catalog-readonly', readOnly);
    const note = document.getElementById('catalogReadonlyNote');
    if (note) note.hidden = !readOnly;
    document.querySelectorAll('#catalogConfigView input').forEach(input => { input.disabled = readOnly; });
}

function getPoleSpanDistance() {
    return Number(lancamentoConfig.poleSpan) > 0 ? Number(lancamentoConfig.poleSpan) : 35;
}

//Definições padrão dos kits automáticos (CEO, Cordoalha, POP, OLT).
//Calculado em runtime porque depende de POP_KIT_CONFIG (definido mais abaixo).
function getDefaultKitDefinitions() {
    return {
        "KIT CEO RAQUETE": { category: 'Fusão', components: [
            { name: "PRENSA DE ESPINAR", quantity: 2 },
            { name: "RAQUETE PARA CEO", quantity: 2 },
            { name: "TAP BRACKET", quantity: 4 },
            { name: "CABO DE AÇO CORDOALHA 3/16 POL", quantity: 50 },
            { name: "ALÇA PREFORMADA PARA CORDOALHA 3/16 POL", quantity: 2 },
            { name: "FITA DE AMARRAÇÃO INOX 16 POL", quantity: 10 },
            { name: "SUPORTE PRESBOW (REX)", quantity: 2 },
            { name: "ISOLADOR ROLDANA", quantity: 2 }
        ]},
        "KIT CEO SUPORTE": { category: 'Fusão', components: [
            { name: "SUPORTE PARA CEO", quantity: 1 },
            { name: "ABRAÇADEIRA DE NYLON", quantity: 4 },
            { name: "ABRAÇADEIRA BAP 3", quantity: 2 }
        ]},
        "KIT ATENDIMENTO CLIENTE": { category: 'Fusão', components: [
            { name: "CONECTOR DE CAMPO SC/APC", quantity: 2 },
            { name: "ESTICADOR PARA CABO DROP", quantity: 2 },
            { name: "PTO - PONTO DE TERMINAÇÃO ÓPTICA", quantity: 1 }
        ]},
        "KIT CORDOALHA": { category: 'Ferragem', components: [
            { name: "SUPORTE PRESBOW (REX)", quantity: 4 },
            { name: "ISOLADOR ROLDANA", quantity: 4 },
            { name: "ALÇA PREFORMADA PARA CORDOALHA 3/16 POL", quantity: 4 },
            { name: "CABO DE AÇO CORDOALHA 3/16 POL", quantity: 50 }
        ]},
        "KIT POP": { category: 'Data Center', components: (typeof POP_KIT_CONFIG !== 'undefined' ? POP_KIT_CONFIG.fixed : []).map(i => ({ name: i.name, quantity: i.quantity })) },
        "KIT OLT": { category: 'Data Center', components: [
            { name: 'CHASSI OLT C650 ZTE', quantity: 1 },
            { name: 'LICENÇA OLT', quantity: 1 },
            { name: 'MÓDULO DE ENERGIA DC C650-C600 PARA OLT ZTE', quantity: 2 },
            { name: 'PLACA CONTROLADORA E SWITCHING C600/C650', quantity: 1 },
            { name: 'SWITCH MPLS 24 PORTAS', quantity: 1 },
            { name: 'SFP 850NM 10G 0,3KM MULTIMODO DUPLEX', quantity: 2 },
            { name: 'SFP GBIC ELÉTRICO', quantity: 1 }
        ]}
    };
}

//Kit "Cabos e alças": qual alça preformada cada tipo de cabo usa (editável no catálogo, aba Kits)
const CABLE_ALCA_KIT_NAME = 'KIT CABOS E ALÇAS';
const CABLE_ALCA_VERSION = 2; //Tabela oficial da empresa (troca de versão descarta escolhas antigas)
//Cabos usados pela empresa, na ordem exibida no kit (alça padrão em CABLE_HARDWARE_MAP)
const CABLE_ALCA_KIT_TYPES = [
    'Cabo AS 80 FO-06', 'Cabo AS 80 FO-12',
    'Cabo AS 200 FO-12', 'Cabo AS 80 FO-24', 'Cabo AS 80 FO-36', 'Cabo AS 80 FO-48',
    'Cabo AS 200 FO-36', 'Cabo AS 80 FO-72', 'Cabo AS 200 FO-24',
    'Cabo AS 80 FO-144',
];

function getCableAlca(cableType) {
    const custom = materialCatalog.cableAlcas?.[cableType];
    return resolveMaterialName(custom || CABLE_HARDWARE_MAP[cableType] || '') || null;
}

//Retorna os componentes de um kit, priorizando o que está no catálogo (editável)
function getKitComponents(kitName) {
    const kit = materialCatalog.kits.find(k => k.name.toUpperCase() === String(kitName).toUpperCase());
    if (kit && kit.components.length) return kit.components;
    const defaults = getDefaultKitDefinitions()[kitName];
    return defaults ? normalizeKitComponents(defaults.components) : [];
}

//Gera um id simples e único para itens do catálogo
function generateCatalogId(prefix = 'mat') {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

//Constrói o catálogo inicial a partir do MATERIAL_PRICES fixo
function buildSeedCatalog() {
    const materials = [];
    const kits = [];
    Object.keys(MATERIAL_PRICES).forEach(name => {
        const info = MATERIAL_PRICES[name] || {};
        if (Array.isArray(info.components) && info.components.length > 0) {
            kits.push({
                id: generateCatalogId('kit'),
                name,
                category: info.category || 'Outros',
                components: normalizeKitComponents(info.components)
            });
        } else {
            materials.push({
                id: generateCatalogId('mat'),
                name,
                category: info.category || 'Outros',
                unit: info.unit || 'un',
                price: Number(info.price) || 0,
                supplier: '',
                code: '',
                notes: ''
            });
        }
    });
    //Inclui os kits automáticos (CEO, Cordoalha, POP, OLT) para edição na aba Kits
    const defaults = getDefaultKitDefinitions();
    const existingKitNames = new Set(kits.map(k => k.name.toUpperCase()));
    Object.keys(defaults).forEach(kitName => {
        if (existingKitNames.has(kitName.toUpperCase())) return;
        kits.push({
            id: generateCatalogId('kit'),
            name: kitName,
            category: defaults[kitName].category || 'Outros',
            components: normalizeKitComponents(defaults[kitName].components)
        });
    });
    return { materials, kits };
}

//Carrega o catálogo salvo da empresa, mesclando novos itens do seed
function loadMaterialCatalog(stored) {
    const seed = buildSeedCatalog();
    if (!stored || !Array.isArray(stored.materials)) {
        materialCatalog = { ...seed, cableAlcas: {}, cableAlcasVersion: CABLE_ALCA_VERSION };
        return;
    }
    //Normaliza itens salvos
    const materials = stored.materials.map(m => ({
        id: m.id || generateCatalogId('mat'),
        name: resolveMaterialName(String(m.name || '').trim()),
        category: m.category || 'Outros',
        unit: m.unit || 'un',
        price: Number(m.price) || 0,
        supplier: m.supplier || '',
        code: m.code || '',
        notes: m.notes || '',
        section: m.section || ''
    })).filter((m, i, all) => m.name && all.findIndex(o => o.name === m.name) === i) //Nome antigo e novo viram um só
        .filter(m => m.notes === 'Da planilha de kits' || !MATERIALS_NOT_IN_SHEET_SET.has(normalizeMaterialName(m.name))); //Fora da planilha da empresa
    const kits = Array.isArray(stored.kits) ? stored.kits.map(k => ({
        id: k.id || generateCatalogId('kit'),
        name: String(k.name || '').trim(),
        category: k.category || 'Outros',
        source: k.source || undefined,
        components: !Array.isArray(k.components) ? []
            : k.source === SHEET_KIT_SOURCE ? k.components.map(c => ({ ...c, quantity: Number(c.quantity) || 1 }))
            : normalizeKitComponents(k.components)
    })).filter(k => k.name) : [];
    //Mescla itens do seed que ainda não existem (atualizações do código)
    const existingNames = new Set([...materials, ...kits].map(i => i.name.toUpperCase()));
    seed.materials.forEach(sm => {
        if (!existingNames.has(sm.name.toUpperCase())) materials.push(sm);
    });
    seed.kits.forEach(sk => {
        if (!existingNames.has(sk.name.toUpperCase())) kits.push(sk);
    });
    //Kits de lançamento por cabo (versão anterior) viraram o kit único "Cabos e alças"
    materialCatalog = {
        materials,
        kits: kits.filter(k => !k.name.toUpperCase().startsWith('KIT LANÇAMENTO ')),
        cableAlcas: stored.cableAlcasVersion === CABLE_ALCA_VERSION && stored.cableAlcas && typeof stored.cableAlcas === 'object' ? { ...stored.cableAlcas } : {},
        cableAlcasVersion: CABLE_ALCA_VERSION,
    };
}

//Salva o catálogo da empresa no banco
function persistMaterialCatalog() {
    return saveCompanySettings({ material_catalog: materialCatalog });
}

//Aplica os preços/itens do catálogo ao MATERIAL_PRICES (reflete na BOM)
function applyCatalogToMaterialPrices() {
    applyMaterialCategoryRules(materialCatalog.materials);
    materialCatalog.materials.forEach(m => {
        const existing = MATERIAL_PRICES[m.name] || {};
        MATERIAL_PRICES[m.name] = {
            ...existing,
            price: Number(m.price) || 0,
            unit: m.unit || 'un',
            category: m.category || existing.category || 'Outros',
            supplier: m.supplier || ''
        };
    });
    materialCatalog.kits.forEach(k => {
        const existing = MATERIAL_PRICES[k.name] || {};
        MATERIAL_PRICES[k.name] = {
            ...existing,
            price: Number(existing.price) || 0,
            unit: existing.unit || 'un',
            category: k.category || existing.category || 'Outros',
            components: k.components.map(c => ({ name: c.name, quantity: Number(c.quantity) || 1 }))
        };
    });
}

//Inicializa o catálogo com os valores padrão; os da empresa chegam após o login
function initMaterialCatalog() {
    loadMaterialCatalog(null);
    applyCatalogToMaterialPrices();
    whenAppReady(loadCompanySettings);
}

//Sincroniza os preços do catálogo em TODAS as listas de materiais já calculadas
//(preserva quantidades e edições manuais; só atualiza o preço unitário)
function syncCatalogPricesIntoBoms() {
    const applyToBom = (bom) => {
        if (!bom || typeof bom !== 'object') return;
        Object.keys(bom).forEach(key => {
            const item = bom[key];
            if (!item || !item.materialName) return;
            const info = MATERIAL_PRICES[item.materialName];
            if (info && typeof info.price === 'number') {
                item.unitPrice = info.price;
            }
        });
    };
    if (typeof projectBoms === 'object' && projectBoms) {
        Object.keys(projectBoms).forEach(pid => applyToBom(projectBoms[pid]));
    }
    if (typeof bomState === 'object' && bomState) {
        applyToBom(bomState);
    }
    //Atualiza a tela da Lista de Materiais se estiver aberta
    const materialModal = document.getElementById('materialModal');
    if (materialModal && materialModal.style.display === 'flex' && typeof renderBomTable === 'function') {
        try { renderBomTable(); } catch (e) { /* ignora */ }
    }
}

/* ------------------ Interface do cadastro de materiais ------------------ */
let catalogActiveTab = 'materials';

function formatCatalogPrice(value) {
    return (Number(value) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

//Categorias únicas do catálogo (materiais + kits)
function getCatalogCategories() {
    const set = new Set();
    materialCatalog.materials.forEach(m => { if (m.category) set.add(m.category); });
    materialCatalog.kits.forEach(k => { if (k.category) set.add(k.category); });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

//Preenche o filtro de categorias (chips), os datalists e o seletor oculto
function populateCatalogCategoryFilters() {
    const categories = getCatalogCategories();
    const filter = document.getElementById('catalogCategoryFilter');
    if (filter) {
        const current = filter.value;
        filter.innerHTML = '<option value="">Todas as categorias</option>' +
            categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
        filter.value = categories.includes(current) ? current : '';
    }
    renderCatalogCategoryChips();
    const datalist = document.getElementById('catalogCategoryOptions');
    if (datalist) {
        datalist.innerHTML = categories.map(c => `<option value="${escapeHtml(c)}"></option>`).join('');
    }
    const matOptions = document.getElementById('kitMaterialOptions');
    if (matOptions) {
        matOptions.innerHTML = materialCatalog.materials
            .map(m => `<option value="${escapeHtml(m.name)}"></option>`).join('');
    }
}

//Cor fixa por categoria (mesma cor nos chips e nos grupos da tabela)
function getCatalogCategoryColor(category) {
    const palette = ['#0f766e', '#2563eb', '#b45309', '#7c3aed', '#be185d', '#15803d', '#0369a1', '#a16207'];
    const fixed = { 'Ferragem': '#b45309', 'Lançamento': '#2563eb', 'Fusão': '#7c3aed', 'Data Center': '#0f766e', 'Clientes': '#15803d' };
    if (fixed[category]) return fixed[category];
    let hash = 0;
    String(category || '').split('').forEach(ch => { hash = (hash * 31 + ch.charCodeAt(0)) >>> 0; });
    return palette[hash % palette.length];
}

function renderCatalogCategoryChips() {
    const wrap = document.getElementById('catalogCategoryChips');
    const filter = document.getElementById('catalogCategoryFilter');
    if (!wrap || !filter) return;
    const source = catalogActiveTab === 'kits' ? materialCatalog.kits : materialCatalog.materials;
    const counts = {};
    source.forEach(item => { const c = item.category || 'Outros'; counts[c] = (counts[c] || 0) + 1; });
    const categories = Object.keys(counts).sort((a, b) => getCatalogCategoryRank(a) - getCatalogCategoryRank(b) || a.localeCompare(b, 'pt-BR'));
    const current = filter.value;
    const chip = (value, label, count, color) => `<button type="button" class="cat3-chip${value === current ? ' is-active' : ''}" data-category="${escapeHtml(value)}" role="tab" style="--chip:${color}"><span class="cat3-chip__dot"></span>${escapeHtml(label)}<small>${count}</small></button>`;
    wrap.innerHTML = chip('', 'Todas', source.length, '#64748b') + categories.map(c => chip(c, c, counts[c], getCatalogCategoryColor(c))).join('');
}

//Escapa texto para uso seguro em HTML
function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function openMaterialCatalogModal() {
    const modal = document.getElementById('materialCatalogModal');
    if (!modal) return;
    populateCatalogCategoryFilters();
    updateCatalogStats();
    setCatalogTab(catalogActiveTab);
    modal.style.display = 'flex';
}

function setCatalogTab(tab) {
    catalogActiveTab = ['kits', 'config'].includes(tab) ? tab : 'materials';
    document.querySelectorAll('.catalog-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.catalogTab === catalogActiveTab);
    });
    const views = { materials: 'catalogMaterialsView', kits: 'catalogKitsView', config: 'catalogConfigView' };
    Object.entries(views).forEach(([key, id]) => {
        const view = document.getElementById(id);
        if (view) view.style.display = catalogActiveTab === key ? '' : 'none';
    });
    const isConfig = catalogActiveTab === 'config';
    document.getElementById('catalogToolbar').style.display = isConfig ? 'none' : '';
    document.getElementById('catalogCategoryChips').style.display = isConfig ? 'none' : '';
    const addBtn = document.getElementById('catalogAddButton');
    if (addBtn) addBtn.textContent = catalogActiveTab === 'kits' ? '+ Novo kit' : '+ Novo material';
    const importBtn = document.getElementById('catalogImportButton');
    if (importBtn) importBtn.hidden = catalogActiveTab === 'kits';
    const apiBtn = document.getElementById('catalogApiSyncButton');
    if (apiBtn) apiBtn.hidden = catalogActiveTab === 'kits';
    const filter = document.getElementById('catalogCategoryFilter');
    if (filter) filter.value = '';
    if (isConfig) renderLancamentoConfigForm();
    else {
        renderCatalogCategoryChips();
        renderCatalog();
    }
}

function renderLancamentoConfigForm() {
    const set = (id, value) => { const el = document.getElementById(id); if (el) el.value = value; };
    set('configPoleSpan', lancamentoConfig.poleSpan);
    set('configPlaquetaPerPole', lancamentoConfig.plaquetaPerPole);
    set('configBapPerPole', lancamentoConfig.bapPerPole);
    set('configSupaPerPole', lancamentoConfig.supaPerPole);
    set('configAlcaPerSupa', lancamentoConfig.alcaPerSupa);
    set('configDropSlack', lancamentoConfig.dropSlack);
    set('configLaborHourlyRate', laborConfig.hourlyRate);
    set('configLaborHoursPerDay', laborConfig.hoursPerDay);
    set('configCablePerDay', laborConfig.cablePerDay);
    set('configCtoPerDay', laborConfig.ctoPerDay);
    set('configCeoPerDay', laborConfig.ceoPerDay);
    updateLancamentoPreview();
    updateLaborPreview();
    applyCatalogPermissions();
}

function readLaborConfigForm() {
    const num = (id) => parseFloat(document.getElementById(id)?.value);
    return normalizeLaborConfig({
        hourlyRate: num('configLaborHourlyRate'),
        hoursPerDay: num('configLaborHoursPerDay'),
        cablePerDay: num('configCablePerDay'),
        ctoPerDay: num('configCtoPerDay'),
        ceoPerDay: num('configCeoPerDay')
    });
}

function updateLaborPreview() {
    const preview = document.getElementById('configLaborPreview');
    if (!preview) return;
    const cfg = readLaborConfigForm();
    const dayCost = cfg.hourlyRate * cfg.hoursPerDay;
    const money = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const days = Math.ceil(5000 / cfg.cablePerDay + 20 / cfg.ctoPerDay + 2 / cfg.ceoPerDay);
    preview.innerHTML = `<span class="cat3-example__label">Exemplo</span>
        <span class="cat3-example__flow">
            <span class="cat3-token">5.000 m de cabo</span><span class="cat3-token">20 CTOs</span><span class="cat3-token">2 CEOs</span>
            <span class="cat3-arrow">→</span>
            <span class="cat3-token cat3-token--strong">${days} dias</span>
            <span class="cat3-token cat3-token--strong">${money(dayCost)} / dia por técnico</span>
            <span class="cat3-token cat3-token--strong">${money(days * dayCost)} por técnico</span>
        </span>`;
}

//Mostra um exemplo de cálculo com os valores atuais do formulário
function updateLancamentoPreview() {
    const preview = document.getElementById('configLancamentoPreview');
    if (!preview) return;
    const num = (id, fb) => {
        const v = parseFloat(document.getElementById(id)?.value);
        return Number.isFinite(v) && v >= 0 ? v : fb;
    };
    const span = num('configPoleSpan', 35) > 0 ? num('configPoleSpan', 35) : 35;
    const plaq = num('configPlaquetaPerPole', 1);
    const bap = num('configBapPerPole', 1);
    const supa = num('configSupaPerPole', 2);
    const alca = num('configAlcaPerSupa', 1);
    const exemplo = 1000;
    const postes = Math.ceil(exemplo / span);
    const poles = Array.from({ length: 7 }, () => '<i class="cat3-pole"></i>').join('<i class="cat3-span"></i>');
    preview.innerHTML = `<span class="cat3-example__label">Exemplo</span>
        <div class="cat3-poles" aria-hidden="true">${poles}<em>${span} m</em></div>
        <span class="cat3-example__flow">
            <span class="cat3-token">Cabo de ${exemplo} m</span>
            <span class="cat3-arrow">→</span>
            <span class="cat3-token cat3-token--strong">${postes} postes</span>
            <span class="cat3-token">${postes * plaq} plaquetas</span>
            <span class="cat3-token">${postes * bap} BAP</span>
            <span class="cat3-token">${postes * supa} SUPAS</span>
            <span class="cat3-token">${postes * supa * alca} alças</span>
        </span>`;
}

async function saveLancamentoConfigHandler() {
    if (!AppSession.isAdmin) {
        showAlert('Sem permissão', 'Somente o administrador da empresa pode alterar as configurações.');
        return;
    }
    laborConfig = readLaborConfigForm();
    const num = (id, fallback) => {
        const v = parseFloat(document.getElementById(id)?.value);
        return Number.isFinite(v) && v >= 0 ? v : fallback;
    };
    const poleSpan = num('configPoleSpan', 35);
    lancamentoConfig = {
        poleSpan: poleSpan > 0 ? poleSpan : 35,
        plaquetaPerPole: num('configPlaquetaPerPole', 1),
        bapPerPole: num('configBapPerPole', 1),
        supaPerPole: num('configSupaPerPole', 2),
        alcaPerSupa: num('configAlcaPerSupa', 1),
        dropSlack: num('configDropSlack', DEFAULT_LANCAMENTO_CONFIG.dropSlack)
    };
    const saved = await persistLancamentoConfig();
    if (typeof refreshClientDrops === 'function') refreshClientDrops();
    renderLancamentoConfigForm();
    //Recalcula a lista de materiais do projeto ativo, se houver
    if (typeof refreshBomAfterProjectChange === 'function') {
        try { refreshBomAfterProjectChange(); } catch (e) { /* ignora se não houver projeto */ }
    }
    if (saved) showAlert('Configurações salvas', 'As novas configurações valem para toda a equipe da empresa.');
}

function getCatalogFilters() {
    const term = (document.getElementById('catalogSearchInput')?.value || '').trim().toLowerCase();
    const category = document.getElementById('catalogCategoryFilter')?.value || '';
    return { term, category };
}

function renderCatalog() {
    updateCatalogStats();
    if (catalogActiveTab === 'kits') renderCatalogKits();
    else renderCatalogMaterials();
}

//Ordem fixa das categorias na tabela de materiais
const CATALOG_CATEGORY_ORDER = ['Ferragem', 'Lançamento', 'Fusão', 'Data Center'];

function getCatalogCategoryRank(cat) {
    const idx = CATALOG_CATEGORY_ORDER.indexOf(cat);
    return idx === -1 ? CATALOG_CATEGORY_ORDER.length : idx;
}

function buildCatalogMaterialRowHtml(m) {
    const meta = [m.code ? `Cód. ${escapeHtml(m.code)}` : '', m.notes ? escapeHtml(m.notes) : ''].filter(Boolean).join(' · ');
    return `
        <tr data-material-id="${m.id}">
            <td><span class="catalog-item-name">${escapeHtml(m.name)}</span>${meta ? `<small class="cat3-meta">${meta}</small>` : ''}</td>
            <td><span class="cat3-unit">${escapeHtml(m.unit || 'un')}</span></td>
            <td class="cat3-num"><button type="button" class="cat3-price" data-price-material="${m.id}" title="${AppSession.isAdmin ? 'Clique para editar o preço' : ''}">R$ ${formatCatalogPrice(m.price)}</button></td>
            <td>${m.supplier ? escapeHtml(m.supplier) : '<span class="catalog-supplier-empty">—</span>'}</td>
            <td>
                <div class="catalog-row-actions">
                    <button type="button" class="catalog-icon-btn" data-edit-material="${m.id}" title="Editar material" aria-label="Editar material">${uiIcon('edit')}</button>
                    <button type="button" class="catalog-icon-btn danger" data-delete-material="${m.id}" title="Excluir material" aria-label="Excluir material">${uiIcon('trash')}</button>
                </div>
            </td>
        </tr>`;
}

function renderCatalogMaterials() {
    const body = document.getElementById('catalogMaterialsBody');
    const empty = document.getElementById('catalogMaterialsEmpty');
    if (!body) return;
    const { term, category } = getCatalogFilters();
    const rows = materialCatalog.materials
        .filter(m => !category || (m.category || 'Outros') === category)
        .filter(m => !term ||
            m.name.toLowerCase().includes(term) ||
            (m.category || '').toLowerCase().includes(term) ||
            (m.supplier || '').toLowerCase().includes(term) ||
            (m.code || '').toLowerCase().includes(term));
    const groups = {};
    rows.forEach(m => {
        const cat = m.category || 'Outros';
        (groups[cat] = groups[cat] || []).push(m);
    });
    const orderedCats = Object.keys(groups).sort((a, b) => {
        const ra = getCatalogCategoryRank(a);
        const rb = getCatalogCategoryRank(b);
        return ra !== rb ? ra - rb : a.localeCompare(b, 'pt-BR');
    });
    body.innerHTML = orderedCats.map(cat => {
        const items = groups[cat].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
        const total = items.reduce((sum, m) => sum + (Number(m.price) || 0), 0);
        return `<tr class="catalog-group-row" style="--chip:${getCatalogCategoryColor(cat)}"><td colspan="5"><span class="cat3-chip__dot"></span>${escapeHtml(cat)} <span class="catalog-group-count">${items.length} ite${items.length === 1 ? 'm' : 'ns'} · média R$ ${formatCatalogPrice(total / items.length)}</span></td></tr>`
            + items.map(buildCatalogMaterialRowHtml).join('');
    }).join('');
    if (empty) empty.style.display = rows.length ? 'none' : 'flex';
}

//Edição do preço direto na tabela (administrador)
function startInlinePriceEdit(button) {
    if (!AppSession.isAdmin) return;
    const material = materialCatalog.materials.find(m => m.id === button.dataset.priceMaterial);
    if (!material) return;
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.step = '0.01';
    input.className = 'cat3-price-input';
    input.value = Number(material.price) || 0;
    button.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (save) => {
        if (done) return;
        done = true;
        const value = parseFloat(input.value);
        if (save && Number.isFinite(value) && value >= 0 && value !== Number(material.price)) {
            material.price = Math.round(value * 100) / 100;
            persistMaterialCatalog();
            applyCatalogToMaterialPrices();
            syncCatalogPricesIntoBoms();
            showToast('Preço atualizado', `${material.name}: R$ ${formatCatalogPrice(material.price)}`);
        }
        renderCatalogMaterials();
    };
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finish(true); }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
}

function renderCatalogKits() {
    const list = document.getElementById('catalogKitsList');
    const empty = document.getElementById('catalogKitsEmpty');
    if (!list) return;
    const { term, category } = getCatalogFilters();
    const priceOf = (name) => Number(materialCatalog.materials.find(m => m.name.toUpperCase() === String(name).toUpperCase())?.price) || 0;
    const kits = materialCatalog.kits
        .filter(k => !category || (k.category || 'Outros') === category)
        .filter(k => !term ||
            k.name.toLowerCase().includes(term) ||
            (k.category || '').toLowerCase().includes(term) ||
            k.components.some(c => c.name.toLowerCase().includes(term)))
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    const cableKitMatches = (!category || category === 'Lançamento') && (!term || CABLE_ALCA_KIT_NAME.toLowerCase().includes(term) || 'cabo alça'.includes(term));
    const cableKitHtml = cableKitMatches ? renderCableAlcaKit(priceOf) : '';
    list.innerHTML = cableKitHtml + kits.map(k => {
        const unitOf = (c) => (Number.isFinite(c.price) ? c.price : priceOf(c.name));
        const total = k.components.reduce((sum, c) => sum + unitOf(c) * (Number(c.quantity) || 0), 0);
        const color = getCatalogCategoryColor(k.category || 'Outros');
        return `
        <article class="catalog-kit-card cat3-kit" style="--chip:${color}">
            <header>
                <div>
                    <h4>${escapeHtml(k.name)}</h4>
                    <span class="kit-card-meta"><span class="cat3-chip__dot"></span>${escapeHtml(k.category || 'Outros')} · ${k.components.length} ite${k.components.length === 1 ? 'm' : 'ns'}</span>
                </div>
                <strong class="cat3-kit__total">R$ ${formatCatalogPrice(total)}</strong>
            </header>
            <ul>${k.components.map(c => `<li><span class="kit-li-qty">${c.quantity}×</span><span class="cat3-kit__name">${escapeHtml(c.name)}</span><span class="cat3-kit__price">R$ ${formatCatalogPrice(unitOf(c) * (Number(c.quantity) || 0))}</span></li>`).join('') || '<li class="cat3-kit__empty">Sem itens</li>'}</ul>
            <div class="catalog-row-actions">
                <button type="button" class="catalog-icon-btn" data-edit-kit="${k.id}">${uiIcon('edit')} Editar</button>
                <button type="button" class="catalog-icon-btn danger" data-delete-kit="${k.id}" title="Excluir kit" aria-label="Excluir kit">${uiIcon('trash')}</button>
            </div>
        </article>`;
    }).join('');
    if (empty) empty.style.display = kits.length || cableKitHtml ? 'none' : 'flex';
}

//Cartão do kit "Cabos e alças": clicando, lista cada cabo com a sua alça (trocável)
function renderCableAlcaKit(priceOf) {
    const alcaOptions = [...new Set(materialCatalog.materials
        .filter(m => /ALÇA PREFORMADA OPDE/i.test(m.name))
        .map(m => m.name))].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
    const cableTypes = CABLE_ALCA_KIT_TYPES;
    const color = getCatalogCategoryColor('Lançamento');
    const rows = cableTypes.map(type => {
        const alca = getCableAlca(type) || '';
        const options = (alcaOptions.includes(alca) || !alca ? alcaOptions : [alca, ...alcaOptions])
            .map(name => `<option value="${escapeHtml(name)}"${name === alca ? ' selected' : ''}>${escapeHtml(name)}</option>`).join('');
        return `<li class="cable-alca-row">
            <span class="cable-alca-row__cable">${escapeHtml(resolveMaterialName(type))}</span>
            <span class="cable-alca-row__arrow" aria-hidden="true">→</span>
            <select class="cable-alca-row__select" data-cable-alca="${escapeHtml(type)}" aria-label="Alça do cabo"${AppSession.canEdit ? '' : ' disabled'}>${options}</select>
            <span class="cat3-kit__price">R$ ${formatCatalogPrice(priceOf(alca))}</span>
        </li>`;
    }).join('');
    return `
        <article class="catalog-kit-card cat3-kit cable-alca-kit" style="--chip:${color}">
            <details>
                <summary>
                    <div>
                        <h4>${CABLE_ALCA_KIT_NAME}</h4>
                        <span class="kit-card-meta"><span class="cat3-chip__dot"></span>Lançamento · ${cableTypes.length} cabos · clique para ver cada cabo e a sua alça</span>
                    </div>
                </summary>
                <ul class="cable-alca-list">${rows}</ul>
                <p class="cable-alca-note">As quantidades por poste (alças por SUPA, SUPA, BAP e plaquetas) ficam em Configurações.</p>
            </details>
        </article>`;
}

//Atualiza os contadores do cabeçalho
function updateCatalogStats() {
    const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
    set('catalogMaterialsCount', materialCatalog.materials.length);
    set('catalogKitsCount', materialCatalog.kits.length);
    set('catalogCategoriesCount', getCatalogCategories().length);
}

/* ------------------ Formulário de material ------------------ */
function openMaterialForm(materialId = null) {
    const modal = document.getElementById('materialFormModal');
    if (!modal) return;
    const material = materialId ? materialCatalog.materials.find(m => m.id === materialId) : null;
    document.getElementById('materialFormTitle').textContent = material ? 'Editar Material' : 'Adicionar Material';
    document.getElementById('materialFormId').value = material ? material.id : '';
    document.getElementById('materialFormName').value = material ? material.name : '';
    document.getElementById('materialFormCategory').value = material ? (material.category || '') : '';
    document.getElementById('materialFormUnit').value = material ? (material.unit || 'un') : 'un';
    document.getElementById('materialFormPrice').value = material ? (material.price || 0) : 0;
    document.getElementById('materialFormCode').value = material ? (material.code || '') : '';
    document.getElementById('materialFormSupplier').value = material ? (material.supplier || '') : '';
    document.getElementById('materialFormNotes').value = material ? (material.notes || '') : '';
    populateCatalogCategoryFilters();
    modal.style.display = 'flex';
}

function saveMaterialFormHandler() {
    const id = document.getElementById('materialFormId').value;
    const name = document.getElementById('materialFormName').value.trim();
    if (!name) {
        showAlert('Atenção', 'Informe o nome do material.');
        return;
    }
    const duplicate = materialCatalog.materials.find(m => m.id !== id && m.name.toUpperCase() === name.toUpperCase())
        || materialCatalog.kits.find(k => k.name.toUpperCase() === name.toUpperCase());
    if (duplicate) {
        showAlert('Atenção', 'Já existe um material ou kit com esse nome.');
        return;
    }
    const data = {
        name,
        category: document.getElementById('materialFormCategory').value.trim() || 'Outros',
        unit: document.getElementById('materialFormUnit').value || 'un',
        price: parseFloat(document.getElementById('materialFormPrice').value) || 0,
        code: document.getElementById('materialFormCode').value.trim(),
        supplier: document.getElementById('materialFormSupplier').value.trim(),
        notes: document.getElementById('materialFormNotes').value.trim()
    };
    if (id) {
        const material = materialCatalog.materials.find(m => m.id === id);
        if (material) Object.assign(material, data);
    } else {
        materialCatalog.materials.push({ id: generateCatalogId('mat'), ...data });
    }
    persistMaterialCatalog();
    applyCatalogToMaterialPrices();
    syncCatalogPricesIntoBoms();
    populateCatalogCategoryFilters();
    renderCatalog();
    document.getElementById('materialFormModal').style.display = 'none';
}

function deleteCatalogMaterial(materialId) {
    const material = materialCatalog.materials.find(m => m.id === materialId);
    if (!material) return;
    showConfirm('Excluir material', `Remover "${material.name}" do catálogo?`, () => {
        materialCatalog.materials = materialCatalog.materials.filter(m => m.id !== materialId);
        persistMaterialCatalog();
        populateCatalogCategoryFilters();
        renderCatalog();
    });
}

/* ------------------ Formulário de kit ------------------ */
function addKitComponentRow(name = '', quantity = 1) {
    const list = document.getElementById('kitComponentsList');
    if (!list) return;
    const row = document.createElement('div');
    row.className = 'kit-component-row';
    row.innerHTML = `
        <input type="text" class="kit-component-name" list="kitMaterialOptions" placeholder="Material" value="${escapeHtml(name)}" />
        <input type="number" class="kit-component-qty" min="0" step="1" value="${Number(quantity) || 1}" />
        <button type="button" class="kit-component-remove" title="Remover">&times;</button>`;
    row.querySelector('.kit-component-remove').addEventListener('click', () => row.remove());
    list.appendChild(row);
}

function openKitForm(kitId = null) {
    const modal = document.getElementById('kitFormModal');
    if (!modal) return;
    const kit = kitId ? materialCatalog.kits.find(k => k.id === kitId) : null;
    document.getElementById('kitFormTitle').textContent = kit ? 'Editar Kit' : 'Adicionar Kit';
    document.getElementById('kitFormId').value = kit ? kit.id : '';
    document.getElementById('kitFormName').value = kit ? kit.name : '';
    document.getElementById('kitFormCategory').value = kit ? (kit.category || '') : '';
    const list = document.getElementById('kitComponentsList');
    if (list) list.innerHTML = '';
    populateCatalogCategoryFilters();
    if (kit && kit.components.length) {
        kit.components.forEach(c => addKitComponentRow(c.name, c.quantity));
    } else {
        addKitComponentRow();
    }
    modal.style.display = 'flex';
}

function saveKitFormHandler() {
    const id = document.getElementById('kitFormId').value;
    const name = document.getElementById('kitFormName').value.trim();
    if (!name) {
        showAlert('Atenção', 'Informe o nome do kit.');
        return;
    }
    const duplicate = materialCatalog.kits.find(k => k.id !== id && k.name.toUpperCase() === name.toUpperCase())
        || materialCatalog.materials.find(m => m.name.toUpperCase() === name.toUpperCase());
    if (duplicate) {
        showAlert('Atenção', 'Já existe um material ou kit com esse nome.');
        return;
    }
    const components = [];
    document.querySelectorAll('#kitComponentsList .kit-component-row').forEach(row => {
        const cName = row.querySelector('.kit-component-name').value.trim();
        const cQty = Number(row.querySelector('.kit-component-qty').value) || 0;
        if (cName && cQty > 0) components.push({ name: cName, quantity: cQty });
    });
    if (!components.length) {
        showAlert('Atenção', 'Adicione pelo menos um material ao kit.');
        return;
    }
    const data = {
        name,
        category: document.getElementById('kitFormCategory').value.trim() || 'Outros',
        components
    };
    if (id) {
        const kit = materialCatalog.kits.find(k => k.id === id);
        if (kit) Object.assign(kit, data);
    } else {
        materialCatalog.kits.push({ id: generateCatalogId('kit'), ...data });
    }
    persistMaterialCatalog();
    applyCatalogToMaterialPrices();
    populateCatalogCategoryFilters();
    renderCatalog();
    document.getElementById('kitFormModal').style.display = 'none';
}

function deleteCatalogKit(kitId) {
    const kit = materialCatalog.kits.find(k => k.id === kitId);
    if (!kit) return;
    showConfirm('Excluir kit', `Remover o kit "${kit.name}"?`, () => {
        materialCatalog.kits = materialCatalog.kits.filter(k => k.id !== kitId);
        persistMaterialCatalog();
        populateCatalogCategoryFilters();
        renderCatalog();
    });
}

/* ------------------ Importação de planilha de preços ------------------ */
let currentImportPreview = [];

//Normaliza nomes para comparação (sem acentos, maiúsculo, só alfanumérico)
function normalizeMaterialName(str) {
    return String(str || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}

//Converte unidade da planilha para o padrão do sistema
function normalizeImportUnit(unit) {
    const u = String(unit || '').toLowerCase().trim();
    if (u.startsWith('m') && !u.startsWith('un')) return 'm';
    if (u.startsWith('un') || u === 'pç' || u === 'pc' || u === 'pcs') return 'un';
    return 'un';
}

//Lê a planilha e extrai linhas válidas {name, unit, price}
function parseImportWorkbook(arrayBuffer) {
    if (typeof XLSX === 'undefined') {
        throw new Error('Biblioteca de leitura de planilha indisponível.');
    }
    const wb = XLSX.read(arrayBuffer, { type: 'array' });
    const rows = [];
    let block = 0; //Blocos/seções separados por linhas "Total" ou cabeçalhos
    const SECTION_LABELS = ['total', 'valor unitário', 'valor unitario', 'item', 'descrição', 'descricao', 'subtotal'];
    wb.SheetNames.forEach(sheetName => {
        const sheet = wb.Sheets[sheetName];
        if (!sheet) return;
        const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
        let blockHasItems = false;
        matrix.forEach(cols => {
            if (!Array.isArray(cols)) return;
            //Detecta separadores de seção em qualquer coluna (ex.: "Total")
            const isSeparator = cols.some(c => c != null && SECTION_LABELS.includes(String(c).trim().toLowerCase()));
            //Nome = primeira célula de texto
            const name = (cols[0] != null ? String(cols[0]) : '').trim();
            if (isSeparator) {
                if (blockHasItems) { block++; blockHasItems = false; } //Avança para o próximo bloco
                return;
            }
            if (!name) return;
            //Preço = última célula numérica da linha
            let price = null;
            let unit = '';
            for (let i = 1; i < cols.length; i++) {
                const cell = cols[i];
                if (cell == null) continue;
                if (typeof cell === 'number' && isFinite(cell)) {
                    price = cell;
                } else {
                    const txt = String(cell).trim();
                    if (/^[a-zA-Zçãéúíó]+\.?$/.test(txt) && txt.length <= 5) unit = txt;
                    //Tenta converter texto numérico (ex.: "R$ 1,10")
                    const num = parseFloat(txt.replace(/[^0-9,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
                    if (Number.isFinite(num) && txt !== '-' && /\d/.test(txt)) price = num;
                }
            }
            if (price == null || !Number.isFinite(price)) return; //Sem preço válido
            blockHasItems = true;
            rows.push({ name, unit: normalizeImportUnit(unit), price: Number(price), block });
        });
        if (blockHasItems) { block++; blockHasItems = false; } //Separa por planilha
    });
    return rows;
}

//Categoria dos materiais da planilha de preços: só Lançamento (cabos), Fusão ou Ferragem.
//Data Center fica para o que vem da planilha de kits e não existe na planilha de preços.
function classifyPriceSheetCategory(name) {
    const n = normalizeMaterialName(name);
    if (/\b(CFOA|DROP|FIGURA 08|CABO OPTICO|CABO UTP)\b/.test(n)) return 'Lançamento';
    if (/\b(SPLITTER|ADAPTADOR|TUBETE|EMENDA|CEO|BANDEJA|FUSAO|FUSOES|CTO|CAIXA|CAIXAS|PIGTAIL|PIGTAILS|CONECTOR|PTO|DERIVACAO|DIO|DGO|CORDAO|CORDOES|PATCHCORD|TERMINACAO|FOSC)\b/.test(n)) return 'Fusão';
    return 'Ferragem';
}

//Aplica a regra de categorias no catálogo (itens de mão de obra e marcadores internos ficam como estão)
const CATALOG_FIXED_CATEGORY_NAMES = new Set(['CTO', 'RESERVA', 'CASA', 'PLACA', 'MAO DE OBRA REGIONAL', 'MAO DE OBRA TERCEIRIZADA']);
//Seção da planilha de preços → categoria do sistema
function categoryFromSheetSection(section) {
    const s = normalizeMaterialName(section);
    if (!s) return null;
    if (/DATA ?CENTER/.test(s)) return 'Data Center';
    if (/\bCABOS?\b/.test(s)) return 'Lançamento';
    if (/\bFERRAGENS?\b/.test(s)) return 'Ferragem';
    return 'Fusão'; //Seção de caixas, splitters e acessórios de fusão
}

function applyMaterialCategoryRules(materials) {
    materials.forEach(m => {
        if (CATALOG_FIXED_CATEGORY_NAMES.has(normalizeMaterialName(m.name))) return;
        m.category = m.notes === 'Da planilha de kits' ? 'Data Center'
            : (categoryFromSheetSection(m.section) || classifyPriceSheetCategory(m.name));
    });
}

//Infere a categoria de um material novo pelo nome
function inferCategoryFromName(name) {
    const n = normalizeMaterialName(name);
    if (/\b(CABO|FIBRA|FIBRAS|DROP|CFOA|FIGURA 08|FO)\b/.test(n)) return 'Lançamento';
    if (/\b(SPLITTER|ADAPTADOR|TUBETE|EMENDA|CEO|BANDEJA|FUSAO|CTO|CAIXA|PIGTAIL|CONECTOR|PTO|DERIVACAO)\b/.test(n)) return 'Fusão';
    if (/\b(OLT|SFP|XFP|RACK|DGO|CHASSI|SWITCH|BATERIA|FONTE|PATCHCORD|CORDAO|MODULO)\b/.test(n)) return 'Data Center';
    return 'Ferragem';
}

//Pontuação de similaridade entre dois nomes normalizados (Jaccard de tokens)
function nameSimilarity(aNorm, bNorm) {
    const a = new Set(aNorm.split(' ').filter(Boolean));
    const b = new Set(bNorm.split(' ').filter(Boolean));
    if (!a.size || !b.size) return 0;
    let inter = 0;
    a.forEach(t => { if (b.has(t)) inter++; });
    return inter / (a.size + b.size - inter);
}

//Nomes da planilha de preços da empresa → material do sistema (os nomes usados nos cálculos)
//Itens com o mesmo nome dos dois lados não precisam estar aqui.
const SHEET_MATERIAL_ALIASES = {
    'CFOA SM ASU 80 S 06 FIBRAS NR': 'Cabo AS 80 FO-06',
    'CFOA SM ASU 80 S 12 FIBRAS NR': 'Cabo AS 80 FO-12',
    'CFOA SM AS 80 S 24 FIBRAS NR KP': 'Cabo AS 80 FO-24',
    'CFOA SM AS 80 S 36 FIBRAS NR KP': 'Cabo AS 80 FO-36',
    'CFOA SM AS 80 S 48 FIBRAS NR KP': 'Cabo AS 80 FO-48',
    'CFOA SM AS 80 S 72 FIBRAS NR KP': 'Cabo AS 80 FO-72',
    'CFOA SM AS 80 S 144 FIBRAS NR KP': 'Cabo AS 80 FO-144',
    'CFOA SM AS 200 S 12 FIBRAS NR KP': 'Cabo AS 200 FO-12',
    'CFOA SM AS 200 S 24 FIBRAS NR KP': 'Cabo AS 200 FO-24',
    'CFOA SM AS 200 S 36 FIBRAS NR KP': 'Cabo AS 200 FO-36',
    'DROP FLAT 1FO': 'CABO DROP FLAT LOW FRICTION 1F',
    'SPLITTER FUSAO 1 2': 'Splitter 1/2',
    'SPLITTER FUSAO 1 4': 'Splitter 1/4',
    'SPLITTER FUSAO 1 8': 'Splitter 1/8',
    'SPLITTER CONECTORIZADO 1 8 SC APC': 'Splitter 1/8 APC',
    'SPLITTER CONECTORIZADO 1 8 SC UPC': 'Splitter 1/8 UPC',
    'SPLITTER CONECTORIZADO 1 16 SC APC': 'Splitter 1/16 APC',
    'SPLITTER CONECTORIZADO 1 16 SC UPC': 'Splitter 1/16 UPC',
    'CTO FIBERSUL': 'CAIXA DE ATENDIMENTO',
    'CAIXA DE TERMINACAO OPTICA PREDIAL': 'CAIXA DE ATENDIMENTO PREDIAL',
    'CAIXAS DE FUSAO 24F EXPANSIVA': 'CAIXA DE EMENDA ÓPTICA (CEO)',
    'CAIXAS DE EMENDA OPTICA DE 144 FIBRAS': 'CAIXA DE EMENDA OPTICA (CEO) 144 FUSÕES',
    'KIT DE BANDEJA PARA CAIXA TIPO FOSC 24F': 'KIT DE BANDEJA PARA CAIXA DE EMENDA',
    'SUPORTE ANCORAGEM PARA CABOS OPTICOS SUPA': 'SUPORTE ANCORAGEM PARA CABOS OPTICOS (SUPAS)',
    'RESERVA OPTILOOP RAQUETE': 'RESERVA OPTILOOP',
    'ALCA PREFORMADA DERIVACAO EM T': 'DERIVAÇÃO EM T',
    'PLAQUETA DE IDENTIFICACAO DE CABOS': 'PLAQUETA DE IDENTIFICAÇÃO',
    'ARAME DE ESPINAR BOBINA DE 105M': 'ARAME DE ESPIMAR (105 m)',
    'PRENCA PARA ESPINAR': 'PRENSA DE ESPINAR',
    'PONTO DE TERMINACAO OPTICA PTO': 'PTO - PONTO DE TERMINAÇÃO ÓPTICA',
    'CONECTOR PRE POLIDO': 'CONECTOR DE CAMPO SC/APC',
    'CORDOES SC PC SC APC': 'CORDÃO ÓPTICO SIMPLEX MONOMODO SC/UPC > SC/APC 2m',
    'CORDAO OPTICO DUPLEX MULTIMODO LC UPC LC UPC 2M': 'CORDÃO ÓPTICO DUPLEX MULTIMODO LC/UPC > LC/UPC OM3 2M',
    'CORDAO OPTICO DUPLEX MONOMODO LC UPC SC APC 2M': 'CORDÃO ÓPTICO DUPLEX MONOMODO LC/UPC > SC/APC 2M',
    'PATCHCORD MAXITELECOM CAT6 1 5M': 'PATCHCORD CAT6 AZUL 1,5M',
    'DIO DE 144 POSICOES SC APC COM PIGTAILS COR PRETA': 'DGO 144 SC/APC COM PIGTAILS COR PRETA',
    'ROLO VELCRO 3M PARA ORGANIZAR CABOS': 'ROLO VELCRO DE 3 METROS PARA ORGANIZAR CABOS',
    'PORCA GAIOLA PARAFUSO': 'KIT PORCA GAIOLA + PARAFUSO',
    'KIT RODIZIO DE 4 PECAS COM 4 RODAS PARA RACK IPMETAL 60X60CM RP50 PL50X67': 'RODIZIO RP50 PL50X67 - KIT 4 PEÇAS',
    'SFP 1270NM TX 1330NM RX 20KM 10G BIDI': 'SFP 1270NM TX/1330NM RX 20KM, 10G, BIDI',
    'SFP 1330NM TX 1270NM RX 20KM 10G BIDI': 'SFP 1330NM TX/1270NM RX 20KM, 10G, BIDI',
    'SFP MULTIMODO 10G DUPLEX': 'SFP 850NM 10G 0,3KM MULTIMODO DUPLEX',
    'INVERSOR 48VCC 110VCA 600W XPS': 'FONTE INVERSORA 48VCC/110VCA 600W',
    'AR CONDICIONADO SPLIT HI WALL LG DUAL INVERTER 12000 BTUS FRIO': 'AR CONDICIONADO SPLIT HI WALL LG DUAL INVERTER 12000 BTUS FRIO 220V',
};

//Encontra o melhor material correspondente para um nome da planilha
function findCatalogMatch(sheetName, code = '') {
    //Equivalência conhecida entre a planilha e o sistema
    const aliasName = SHEET_MATERIAL_ALIASES[normalizeMaterialName(sheetName)] ? resolveMaterialName(SHEET_MATERIAL_ALIASES[normalizeMaterialName(sheetName)]) : null;
    if (aliasName) {
        const aliasTarget = normalizeMaterialName(aliasName);
        const byAlias = materialCatalog.materials.find(m => normalizeMaterialName(m.name) === aliasTarget);
        if (byAlias) return { material: byAlias, score: 1 };
    }
    //Código igual ao do catálogo tem prioridade sobre o nome
    const byCode = code && materialCatalog.materials.find(m => m.code && String(m.code).trim().toLowerCase() === String(code).trim().toLowerCase());
    if (byCode) return { material: byCode, score: 1 };
    const target = normalizeMaterialName(sheetName);
    let exact = null;
    let best = null;
    let bestScore = 0;
    materialCatalog.materials.forEach(m => {
        const norm = normalizeMaterialName(m.name);
        if (norm === target) { exact = m; return; }
        const score = nameSimilarity(target, norm);
        if (score > bestScore) { bestScore = score; best = m; }
    });
    if (exact) return { material: exact, score: 1 };
    if (best && bestScore >= 0.6) return { material: best, score: bestScore };
    return { material: null, score: bestScore };
}

//Constrói a prévia da importação
function buildImportPreview(rows) {
    const entries = rows.map((row, idx) => {
        const match = findCatalogMatch(row.name, row.code);
        return {
            idx,
            code: row.code || '',
            sheetName: row.name,
            unit: row.unit,
            price: row.price,
            block: row.block || 0,
            matchId: match.material ? match.material.id : null,
            matchCategory: match.material ? (match.material.category || 'Outros') : null,
            score: match.score
        };
    });
    //Categoria dominante de cada bloco (com base nos itens que casaram)
    const blockCategoryVotes = {};
    entries.forEach(e => {
        if (e.matchCategory) {
            blockCategoryVotes[e.block] = blockCategoryVotes[e.block] || {};
            blockCategoryVotes[e.block][e.matchCategory] = (blockCategoryVotes[e.block][e.matchCategory] || 0) + 1;
        }
    });
    const blockCategory = {};
    Object.keys(blockCategoryVotes).forEach(b => {
        blockCategory[b] = Object.entries(blockCategoryVotes[b]).sort((a, c) => c[1] - a[1])[0][0];
    });
    //Define a categoria final de cada item
    entries.forEach(e => {
        e.category = e.matchCategory || blockCategory[e.block] || inferCategoryFromName(e.sheetName);
    });
    return entries;
}

//Determina status com base no material escolhido e preço
function computeImportRowStatus(entry, selectValue) {
    if (!Number.isFinite(entry.price)) return { status: 'invalid', checked: false, currentPrice: null };
    if (selectValue === '__ignore__') return { status: 'ignore', checked: false, currentPrice: null };
    if (selectValue === '__new__') return { status: 'new', checked: true, currentPrice: null };
    const material = materialCatalog.materials.find(m => m.id === selectValue);
    if (!material) return { status: 'ignore', checked: false, currentPrice: null };
    const same = Math.abs((Number(material.price) || 0) - entry.price) < 0.005;
    return { status: same ? 'same' : 'update', checked: !same, currentPrice: Number(material.price) || 0 };
}

const IMPORT_STATUS_LABELS = {
    update: { label: 'Atualizar', cls: 'update' },
    same: { label: 'Sem alteração', cls: 'same' },
    new: { label: 'Novo', cls: 'new' },
    ignore: { label: 'Ignorar', cls: 'invalid' },
    invalid: { label: 'Inválido', cls: 'invalid' }
};

function buildImportMatchSelect(entry) {
    const sorted = [...materialCatalog.materials].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    const options = sorted.map(m =>
        `<option value="${m.id}" ${m.id === entry.matchId ? 'selected' : ''}>${escapeHtml(m.name)}</option>`
    ).join('');
    const defaultIgnore = !entry.matchId ? 'selected' : '';
    return `<select class="import-map-select" data-idx="${entry.idx}">
        <option value="__new__">➕ Adicionar como novo material</option>
        <option value="__ignore__" ${defaultIgnore}>— Ignorar esta linha —</option>
        ${options}
    </select>`;
}

function buildImportRowHtml(entry) {
    const selectValue = entry.matchId || '__ignore__';
    const st = computeImportRowStatus(entry, selectValue);
    const meta = IMPORT_STATUS_LABELS[st.status];
    const disabled = (st.status === 'invalid' || st.status === 'ignore') ? 'disabled' : '';
    return `<tr data-idx="${entry.idx}">
        <td class="import-col-check"><input type="checkbox" class="import-row-check" data-idx="${entry.idx}" ${st.checked ? 'checked' : ''} ${disabled} /></td>
        <td><span class="import-sheet-name">${escapeHtml(entry.sheetName)}</span><small class="import-sheet-meta">${escapeHtml(entry.unit)}</small></td>
        <td>${buildImportMatchSelect(entry)}</td>
        <td class="import-price import-current-price">${st.currentPrice != null ? 'R$ ' + formatCatalogPrice(st.currentPrice) : '—'}</td>
        <td class="import-price">R$ ${formatCatalogPrice(entry.price)}</td>
        <td><span class="import-badge ${meta.cls}">${meta.label}</span></td>
    </tr>`;
}

function renderImportPreview() {
    const body = document.getElementById('importPreviewBody');
    if (!body) return;
    //Agrupa por categoria/tipo
    const groups = {};
    currentImportPreview.forEach(entry => {
        const cat = entry.category || 'Outros';
        (groups[cat] = groups[cat] || []).push(entry);
    });
    const orderedCats = Object.keys(groups).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    body.innerHTML = orderedCats.map(cat => {
        const rows = groups[cat].map(buildImportRowHtml).join('');
        return `<tr class="import-group-row"><td colspan="6">${escapeHtml(cat)} <span class="import-group-count">(${groups[cat].length})</span></td></tr>${rows}`;
    }).join('');
    updateImportSummary();
}

function updateImportRow(idx) {
    const tr = document.querySelector(`#importPreviewBody tr[data-idx="${idx}"]`);
    const entry = currentImportPreview.find(e => e.idx === idx);
    if (!tr || !entry) return;
    const select = tr.querySelector('.import-map-select');
    const st = computeImportRowStatus(entry, select.value);
    const meta = IMPORT_STATUS_LABELS[st.status];
    const checkbox = tr.querySelector('.import-row-check');
    checkbox.checked = st.checked;
    checkbox.disabled = (st.status === 'invalid' || st.status === 'ignore');
    tr.querySelector('.import-current-price').textContent = st.currentPrice != null ? 'R$ ' + formatCatalogPrice(st.currentPrice) : '—';
    const badge = tr.querySelector('.import-badge');
    badge.className = `import-badge ${meta.cls}`;
    badge.textContent = meta.label;
    updateImportSummary();
}

function updateImportSummary() {
    const summary = document.getElementById('importSummary');
    if (!summary) return;
    let update = 0, novo = 0, same = 0, ignore = 0;
    document.querySelectorAll('#importPreviewBody tr').forEach(tr => {
        const select = tr.querySelector('.import-map-select');
        const idx = Number(tr.dataset.idx);
        const entry = currentImportPreview.find(e => e.idx === idx);
        if (!entry || !select) return;
        const st = computeImportRowStatus(entry, select.value);
        if (st.status === 'update') update++;
        else if (st.status === 'new') novo++;
        else if (st.status === 'same') same++;
        else ignore++;
    });
    summary.innerHTML =
        `<span><strong>${currentImportPreview.length}</strong> itens lidos</span>` +
        `<span class="import-badge update">${update} para atualizar</span>` +
        `<span class="import-badge new">${novo} novos</span>` +
        `<span class="import-badge same">${same} sem alteração</span>` +
        `<span class="import-badge invalid">${ignore} ignorados</span>`;
}

function handleCatalogImportFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const rows = parseImportWorkbook(e.target.result);
            if (!rows.length) {
                showAlert('Planilha vazia', 'Não encontrei itens com preço válido na planilha. Confira se há colunas com o nome do item e o preço unitário.');
                return;
            }
            currentImportPreview = buildImportPreview(rows);
            document.getElementById('importFileName').textContent = `Arquivo: ${file.name}`;
            renderImportPreview();
            const toggleAll = document.getElementById('importToggleAll');
            if (toggleAll) toggleAll.checked = false;
            document.getElementById('materialImportModal').style.display = 'flex';
        } catch (err) {
            console.error(err);
            showAlert('Erro ao ler planilha', 'Não foi possível ler o arquivo. Use um arquivo .xlsx, .xls ou .csv válido.');
        }
    };
    reader.onerror = () => showAlert('Erro', 'Falha ao abrir o arquivo.');
    reader.readAsArrayBuffer(file);
}

// ---------------------------------------------------------------
// Preços pela API de materiais (mesmo formato da FastAPI em api/)
// Ordem: API configurada → planilha ao vivo (Google Sheets) → materiais.json publicado no deploy
// ---------------------------------------------------------------
const MATERIALS_API_URL_KEY = 'routeMapMaterialsApiUrl';
const DEFAULT_MATERIALS_API_URL = ''; //URL da FastAPI, se for publicada num servidor (ex.: https://routemap-materiais.onrender.com)
const MATERIALS_SHEET_ID = '1vM1Oobfzbz0MnTKku1Vo6Nxpf9sOkYWBN9tiUqzjMbk';
const MATERIALS_SHEET_GID = '0';
const MATERIALS_HEADER_ALIASES = {
    codigo: ['codigo', 'cod', 'cod.', 'codigo do item', 'item', 'sku', 'referencia', 'ref'],
    descricao: ['descricao', 'descricao do item', 'material', 'produto', 'nome'],
    unidade: ['unidade', 'und', 'un', 'unid', 'unid.', 'medida'],
    valor_unitario: ['valor unitario', 'vlr unitario', 'preco unitario', 'valor unit', 'valor', 'preco', 'custo unitario'],
};

function getMaterialsApiUrl() {
    let saved = '';
    try { saved = localStorage.getItem(MATERIALS_API_URL_KEY) || ''; } catch (e) { /* sem armazenamento */ }
    return (saved || DEFAULT_MATERIALS_API_URL).replace(/\/+$/, '');
}

function normalizeSheetHeader(text) {
    return String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function parseSheetPrice(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    let text = String(value ?? '').trim();
    if (!/\d/.test(text)) return null;
    text = text.replace(/[^0-9,.-]/g, '');
    if (text.includes(',') && text.includes('.')) {
        text = text.lastIndexOf(',') > text.lastIndexOf('.') ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
    } else if (text.includes(',')) {
        text = text.replace(/\./g, '').replace(',', '.');
    }
    const number = parseFloat(text);
    return Number.isFinite(number) ? number : null;
}

//Lê o CSV da planilha no mesmo formato de resposta da API: { itens: [{ codigo, descricao, unidade, valor_unitario }] }
function parseMaterialsSheetCsv(csvText) {
    const wb = XLSX.read(csvText, { type: 'string', raw: true });
    const matrix = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
    let start = -1;
    let cols = null;
    for (let r = 0; r < Math.min(matrix.length, 30) && start < 0; r++) {
        const cells = (matrix[r] || []).map(normalizeSheetHeader);
        const found = {};
        Object.entries(MATERIALS_HEADER_ALIASES).forEach(([field, aliases]) => {
            const col = cells.findIndex((cell, i) => !Object.values(found).includes(i)
                && (aliases.includes(cell) || aliases.some(a => a.length > 3 && cell.startsWith(a))));
            if (col >= 0) found[field] = col;
        });
        if ('descricao' in found && 'valor_unitario' in found) { start = r; cols = found; }
    }
    if (start < 0) throw new Error('Cabeçalho não encontrado na planilha (Descrição e Valor unitário).');
    const get = (row, field) => (field in cols ? String(row[cols[field]] ?? '').trim() : '');
    const itens = [];
    matrix.slice(start + 1).forEach(row => {
        const descricao = get(row, 'descricao');
        const valor = parseSheetPrice(get(row, 'valor_unitario'));
        if (!descricao || valor == null || ['total', 'subtotal'].includes(normalizeSheetHeader(descricao))) return;
        itens.push({ codigo: get(row, 'codigo'), descricao, unidade: get(row, 'unidade') || 'un', valor_unitario: valor });
    });
    return { itens, atualizado_em: new Date().toISOString() };
}

async function fetchMaterialsData() {
    const errors = [];
    const apiUrl = getMaterialsApiUrl();
    if (apiUrl) {
        try {
            const response = await fetch(`${apiUrl}/materiais?atualizar=true`);
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.detail || `Erro ${response.status}`);
            return { data, source: 'API de materiais' };
        } catch (error) { errors.push(`API: ${error.message}`); }
    }
    try {
        const url = `https://docs.google.com/spreadsheets/d/${MATERIALS_SHEET_ID}/gviz/tq?tqx=out:csv&gid=${MATERIALS_SHEET_GID}&t=${Date.now()}`;
        const response = await fetch(url);
        const text = await response.text();
        if (!response.ok || /^\s*</.test(text)) throw new Error('planilha não está pública');
        return { data: parseMaterialsSheetCsv(text), source: 'planilha (ao vivo)' };
    } catch (error) { errors.push(`Planilha: ${error.message}`); }
    try {
        const response = await fetch(`materiais.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Erro ${response.status}`);
        return { data: await response.json(), source: 'materiais.json (gerado no deploy)' };
    } catch (error) { errors.push(`materiais.json: ${error.message}`); }
    throw new Error(errors.join(' · '));
}

async function syncCatalogFromApi() {
    const button = document.getElementById('catalogApiSyncButton');
    if (button) button.disabled = true;
    showToast('Buscando preços', 'Lendo a planilha de materiais…', 'progress');
    try {
        const { data, source } = await fetchMaterialsData();
        const rows = (data.itens || [])
            .filter(item => item.descricao && Number.isFinite(Number(item.valor_unitario)))
            .map(item => ({ name: item.descricao, code: item.codigo || '', unit: normalizeImportUnit(item.unidade), price: Number(item.valor_unitario), block: 0 }));
        if (!rows.length) {
            showAlert('Planilha vazia', 'Não encontrei itens com descrição e valor unitário na planilha.');
            return;
        }
        currentImportPreview = buildImportPreview(rows);
        document.getElementById('importFileName').textContent = `Fonte: ${source} · ${rows.length} itens · ${new Date(data.atualizado_em || Date.now()).toLocaleString('pt-BR')}`;
        renderImportPreview();
        const toggleAll = document.getElementById('importToggleAll');
        if (toggleAll) toggleAll.checked = false;
        document.getElementById('materialImportModal').style.display = 'flex';
    } catch (error) {
        console.error('Erro ao buscar a planilha de materiais:', error);
        showAlert('Não foi possível ler a planilha', `Confira se a planilha está compartilhada como "Qualquer pessoa com o link: Leitor". Detalhes: ${error.message}`);
    } finally {
        if (button) button.disabled = false;
    }
}

function applyMaterialImportHandler() {
    let updated = 0, created = 0;
    document.querySelectorAll('#importPreviewBody tr').forEach(tr => {
        const checkbox = tr.querySelector('.import-row-check');
        if (!checkbox || !checkbox.checked || checkbox.disabled) return;
        const idx = Number(tr.dataset.idx);
        const entry = currentImportPreview.find(e => e.idx === idx);
        const select = tr.querySelector('.import-map-select');
        if (!entry || !select) return;
        const value = select.value;
        if (value === '__new__') {
            const dup = materialCatalog.materials.find(m => normalizeMaterialName(m.name) === normalizeMaterialName(entry.sheetName));
            if (dup) {
                dup.price = entry.price;
                updated++;
            } else {
                materialCatalog.materials.push({
                    id: generateCatalogId('mat'),
                    name: entry.sheetName,
                    category: entry.category || 'Outros',
                    unit: entry.unit || 'un',
                    price: entry.price,
                    supplier: '',
                    code: entry.code || '',
                    notes: 'Importado de planilha'
                });
                created++;
            }
        } else if (value !== '__ignore__') {
            const material = materialCatalog.materials.find(m => m.id === value);
            if (material) {
                material.price = entry.price;
                if (entry.code && !material.code) material.code = entry.code;
                updated++;
            }
        }
    });
    if (updated === 0 && created === 0) {
        showAlert('Nada para aplicar', 'Selecione ao menos um item para atualizar ou adicionar.');
        return;
    }
    persistMaterialCatalog();
    applyCatalogToMaterialPrices();
    syncCatalogPricesIntoBoms();
    populateCatalogCategoryFilters();
    renderCatalog();
    document.getElementById('materialImportModal').style.display = 'none';
    showAlert('Importação concluída', `${updated} preço(s) atualizado(s) e ${created} material(is) adicionado(s). As listas de materiais já refletem os novos valores.`);
}

//Conecta todos os eventos da interface do catálogo
function setupMaterialCatalogUI() {
    const openBtn = document.getElementById('materialCatalogButton');
    openBtn?.addEventListener('click', openMaterialCatalogModal);

    const modal = document.getElementById('materialCatalogModal');
    document.getElementById('closeMaterialCatalogModal')?.addEventListener('click', () => {
        if (modal) modal.style.display = 'none';
    });

    document.querySelectorAll('.catalog-tab').forEach(btn => {
        btn.addEventListener('click', () => setCatalogTab(btn.dataset.catalogTab));
    });
    document.getElementById('catalogSearchInput')?.addEventListener('input', renderCatalog);
    document.getElementById('catalogCategoryFilter')?.addEventListener('change', renderCatalog);
    document.getElementById('catalogAddButton')?.addEventListener('click', () => {
        if (catalogActiveTab === 'kits') openKitForm(null);
        else openMaterialForm(null);
    });

    //Delegação de ações na tabela de materiais
    document.getElementById('catalogMaterialsBody')?.addEventListener('click', (e) => {
        const editBtn = e.target.closest('[data-edit-material]');
        const delBtn = e.target.closest('[data-delete-material]');
        const priceBtn = e.target.closest('[data-price-material]');
        if (editBtn) openMaterialForm(editBtn.dataset.editMaterial);
        else if (delBtn) deleteCatalogMaterial(delBtn.dataset.deleteMaterial);
        else if (priceBtn) startInlinePriceEdit(priceBtn);
    });
    //Chips de categoria
    document.getElementById('catalogCategoryChips')?.addEventListener('click', (e) => {
        const chip = e.target.closest('[data-category]');
        if (!chip) return;
        document.getElementById('catalogCategoryFilter').value = chip.dataset.category;
        renderCatalogCategoryChips();
        renderCatalog();
    });
    //Delegação de ações nos cards de kit
    document.getElementById('catalogKitsList')?.addEventListener('change', (e) => {
        const select = e.target.closest('[data-cable-alca]');
        if (!select) return;
        materialCatalog.cableAlcas = { ...(materialCatalog.cableAlcas || {}), [select.dataset.cableAlca]: select.value };
        persistMaterialCatalog();
        refreshBomAfterProjectChange();
        renderCatalogKits();
        const reopened = document.querySelector('.cable-alca-kit details');
        if (reopened) reopened.open = true;
        showToast('Alça atualizada', `${resolveMaterialName(select.dataset.cableAlca)} → ${select.value}`);
    });
    document.getElementById('catalogKitsList')?.addEventListener('click', (e) => {
        const editBtn = e.target.closest('[data-edit-kit]');
        const delBtn = e.target.closest('[data-delete-kit]');
        if (editBtn) openKitForm(editBtn.dataset.editKit);
        else if (delBtn) deleteCatalogKit(delBtn.dataset.deleteKit);
    });

    //Formulário de material
    document.getElementById('closeMaterialFormModal')?.addEventListener('click', () => {
        document.getElementById('materialFormModal').style.display = 'none';
    });
    document.getElementById('cancelMaterialForm')?.addEventListener('click', () => {
        document.getElementById('materialFormModal').style.display = 'none';
    });
    document.getElementById('saveMaterialForm')?.addEventListener('click', saveMaterialFormHandler);

    //Formulário de kit
    document.getElementById('closeKitFormModal')?.addEventListener('click', () => {
        document.getElementById('kitFormModal').style.display = 'none';
    });
    document.getElementById('cancelKitForm')?.addEventListener('click', () => {
        document.getElementById('kitFormModal').style.display = 'none';
    });
    document.getElementById('kitAddComponentButton')?.addEventListener('click', () => addKitComponentRow());
    document.getElementById('saveKitForm')?.addEventListener('click', saveKitFormHandler);

    //Configurações de lançamento
    document.getElementById('saveLancamentoConfig')?.addEventListener('click', saveLancamentoConfigHandler);
    ['configPoleSpan', 'configPlaquetaPerPole', 'configBapPerPole', 'configSupaPerPole', 'configAlcaPerSupa'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', updateLancamentoPreview);
    });
    ['configLaborHourlyRate', 'configLaborHoursPerDay', 'configCablePerDay', 'configCtoPerDay', 'configCeoPerDay'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', updateLaborPreview);
    });

    //Importação de planilha de preços
    const importBtn = document.getElementById('catalogImportButton');
    const importFile = document.getElementById('catalogImportFile');
    importBtn?.addEventListener('click', () => importFile?.click());
    document.getElementById('catalogApiSyncButton')?.addEventListener('click', syncCatalogFromApi);
    importFile?.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        handleCatalogImportFile(file);
        e.target.value = ''; //Permite reimportar o mesmo arquivo
    });
    document.getElementById('closeMaterialImportModal')?.addEventListener('click', () => {
        document.getElementById('materialImportModal').style.display = 'none';
    });
    document.getElementById('cancelMaterialImport')?.addEventListener('click', () => {
        document.getElementById('materialImportModal').style.display = 'none';
    });
    document.getElementById('applyMaterialImport')?.addEventListener('click', applyMaterialImportHandler);
    //Recalcula status quando o mapeamento muda
    document.getElementById('importPreviewBody')?.addEventListener('change', (e) => {
        if (e.target.classList.contains('import-map-select')) {
            updateImportRow(Number(e.target.dataset.idx));
        } else if (e.target.classList.contains('import-row-check')) {
            updateImportSummary();
        }
    });
    document.getElementById('importToggleAll')?.addEventListener('change', (e) => {
        const checked = e.target.checked;
        document.querySelectorAll('#importPreviewBody .import-row-check').forEach(cb => {
            if (!cb.disabled) cb.checked = checked;
        });
        updateImportSummary();
    });
}

//Configuração do kit POP
const POP_KIT_CONFIG = {
    //Itens variáveis do Kit
    variable: [
        'PLACA OLT LINE ANYPON 16 PORTS CARD (HFTH)',
        'MÓDULO SFP C+ PARA PLACA OLT LINE ANYPON ZTE',
        'CORDÃO ÓPTICO SIMPLEX MONOMODO SC/UPC > SC/APC 2M'
    ],
    //Itens fixos
    fixed: [
        { name: 'RACK INDOOR IPMETAL 44U 800X1000MM / PRETO / PORTA DIANTEIRA PERFURADO E TRASEIRA BI-PARTIDA PERFURADO / CALHA LATERAL', quantity: 1 },
        { name: 'RODIZIO RP50 PL50X67 - KIT 4 PEÇAS', quantity: 1 },
        { name: 'BANDEJA DE VENTILAÇÃO DE TETO PARA RACK IPMETAL 44U 1000MM', quantity: 1 },
        { name: 'GUIA DE CABO 1U EM ABS COR PRETA', quantity: 6 },
        { name: 'KIT PORCA GAIOLA + PARAFUSO', quantity: 100 },
        { name: 'RÉGUA DE TOMADA 2P+T 10A, CABO DE 2,5M COM BITOLA 1,5MM² / SEM FUSÍVEL E DISJUNTOR', quantity: 2 },
        { name: 'ROLO VELCRO DE 3 METROS PARA ORGANIZAR CABOS', quantity: 1 },
        { name: 'DGO 144 SC/APC COM PIGTAILS COR PRETA', quantity: 1 },
        { name: 'CAIXA DE EMENDA OPTICA FIBRACEM 216F JUMBO SVM COM REENTRADA DIAMETRO 13 A 18MM', quantity: 1 },
        { name: 'KIT DE DERIVAÇÃO SVM PARA CEO 144F GROMMET (2 ENTRADAS 7 A 13MM)', quantity: 5 },
        { name: 'CABO ÓPTICO AS 80 S 144 FIBRAS NR KP', quantity: 100 },
        { name: 'ALÇA PREFORMADA OPDE 1007 - 12,8MM A 14,2MM', quantity: 6 },
        { name: 'SUPORTE REX ARMAÇÃO SECUNDÁRIA 1X1 PRESBOW 4,8 MM', quantity: 4 },
        { name: 'ISOLADOR ROLDANA 72X72 PORCELANA', quantity: 4 },
        { name: 'BRAÇADEIRA BAP 3', quantity: 4 },
        { name: 'RESERVA OPTILOOP', quantity: 2 },
        { name: 'CABO DE AÇO CORDOALHA 3/16 POL', quantity: 50 },
        { name: 'ALÇA PREFORMADA PARA CORDOALHA 3/16 (4,8MM)', quantity: 2 },
        { name: 'CORDÃO ÓPTICO DUPLEX MULTIMODO LC/UPC > LC/UPC OM3 2M', quantity: 6 },
        { name: 'CORDÃO ÓPTICO DUPLEX MONOMODO LC/UPC > SC/APC 2M', quantity: 6 },
        { name: 'PATCHCORD CAT6 AZUL 1,5M', quantity: 2 },
        { name: 'PATCHCORD CAT6 AZUL 2,5M', quantity: 2 },
        { name: 'CHASSI OLT C650 ZTE', quantity: 1 },
        { name: 'LICENÇA OLT', quantity: 1 },
        { name: 'MÓDULO DE ENERGIA DC C650-C600 PARA OLT ZTE', quantity: 2 },
        { name: 'PLACA CONTROLADORA E SWITCHING C600/C650', quantity: 1 },
        { name: 'SWITCH MPLS 24 PORTAS', quantity: 1 },
        { name: 'SFP 1270NM TX/1330NM RX 20KM, 10G, BIDI', quantity: 1 },
        { name: 'SFP 1330NM TX/1270NM RX 20KM, 10G, BIDI', quantity: 1 },
        { name: 'SFP 850NM 10G 0,3KM MULTIMODO DUPLEX', quantity: 2 },
        { name: 'SFP GBIC ELÉTRICO', quantity: 2 },
        { name: 'FONTE RETIFICADORA 48VCC / 100A ~ 200A', quantity: 1 },
        { name: 'BATERIA DE LÍTIO 100A FB100B3 ZTE', quantity: 1 },
        { name: 'FONTE INVERSORA 48VCC/110VCA 600W', quantity: 1 },
        { name: 'VALOR ESTIMADO COM MATERIAIS ELÉTRICOS, DISJUNTORES, QDC, CABOS, ILUMINAÇÃO, ETC,.', quantity: 1 },
        { name: 'PRESTAÇÃO DE SERVIÇO ELETRICISTA', quantity: 1 },
        { name: 'AR CONDICIONADO SPLIT HI WALL LG DUAL INVERTER 12000 BTUS FRIO 220V', quantity: 1 },
        { name: 'PRESTAÇÃO DE SERVIÇO INSTALAÇÃO AR CONDICIONADO', quantity: 1 },
        { name: 'CAMERA DE MONITORAMENTO IP INTELBRAS VIP 1220 B G3', quantity: 1 },
        { name: 'MÉDIA DE ALUGUEL MENSAL', quantity: 1 }
    ]
};

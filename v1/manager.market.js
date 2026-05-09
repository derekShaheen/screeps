var debug = require('utils.debug');

var DEFAULT_SETTINGS = {
    enabled: true,
    runInterval: 10,
    minCredits: 10000,
    minDealAmount: 100,
    maxDealAmount: 5000,
    minTerminalEnergy: 3000,
    maxTransactionEnergy: 2500,
    energyCreditValue: 0.05,
    mineralReserve: 3000,
    reagentReserve: 3000,
    productReserve: 3000,
    sellSurplus: true,
    sellMinEffectivePrice: 0.01,
    buyEnergy: true,
    buyEnergyBelow: 20000,
    buyEnergyTarget: 40000,
    maxEnergyBuyPrice: 0.25,
    buyLabReagents: true,
    buyReagentBelow: 3000,
    buyReagentTarget: 6000,
    maxReagentBuyPrice: 1
};

function getSettings(room) {
    if(!room.memory.market) {
        room.memory.market = {};
    }

    for(var key in DEFAULT_SETTINGS) {
        if(room.memory.market[key] === undefined) {
            room.memory.market[key] = DEFAULT_SETTINGS[key];
        }
    }

    if(!room.memory.market.resourceReserves) {
        room.memory.market.resourceReserves = {};
    }

    if(!room.memory.market.minSellPrices) {
        room.memory.market.minSellPrices = {};
    }

    if(!room.memory.market.maxBuyPrices) {
        room.memory.market.maxBuyPrices = {};
    }

    return room.memory.market;
}

function getTerminal(room) {
    return room.terminal && room.terminal.my ? room.terminal : null;
}

function getStorage(room) {
    return room.storage && room.storage.my ? room.storage : null;
}

function getStoredAmount(room, resourceType) {
    var amount = 0;
    var terminal = getTerminal(room);
    var storage = getStorage(room);

    if(terminal) {
        amount += terminal.store[resourceType] || 0;
    }

    if(storage) {
        amount += storage.store[resourceType] || 0;
    }

    return amount;
}

function getOffset(roomName) {
    var total = 0;
    for(var i = 0; i < roomName.length; i++) {
        total += roomName.charCodeAt(i);
    }

    return total;
}

function shouldRun(room, settings) {
    return settings.enabled !== false &&
        typeof Game.market !== 'undefined' &&
        (!settings.runInterval || (Game.time + getOffset(room.name)) % settings.runInterval === 0);
}

function getReactionProduct(first, second) {
    if(typeof REACTIONS === 'undefined' ||
        !first ||
        !second ||
        !REACTIONS[first] ||
        !REACTIONS[first][second]) {
        return null;
    }

    return REACTIONS[first][second];
}

function getReactionPairForProduct(product) {
    if(typeof REACTIONS === 'undefined' || !product) {
        return null;
    }

    for(var first in REACTIONS) {
        for(var second in REACTIONS[first]) {
            if(REACTIONS[first][second] == product) {
                return {
                    first: first,
                    second: second,
                    product: product
                };
            }
        }
    }

    return null;
}

function getLabPlan(room) {
    var lab = room.memory.lab || {};
    var reagentA = lab.reagentA || lab.firstReagent || lab.activeReagentA;
    var reagentB = lab.reagentB || lab.secondReagent || lab.activeReagentB;
    var product = null;

    if(reagentA && reagentB) {
        product = getReactionProduct(reagentA, reagentB);
        if(product) {
            return {
                first: reagentA,
                second: reagentB,
                product: product
            };
        }
    }

    product = lab.targetProduct || lab.activeProduct;
    return getReactionPairForProduct(product);
}

function getResourceReserve(room, settings, resourceType) {
    if(settings.resourceReserves[resourceType] !== undefined) {
        return settings.resourceReserves[resourceType];
    }

    if(resourceType == RESOURCE_ENERGY) {
        return settings.buyEnergyTarget;
    }

    var reserve = settings.mineralReserve;
    var labPlan = getLabPlan(room);
    if(labPlan) {
        if(resourceType == labPlan.first || resourceType == labPlan.second) {
            reserve = Math.max(reserve, settings.reagentReserve);
        }

        if(resourceType == labPlan.product) {
            var labMemory = room.memory.lab || {};
            reserve = Math.max(reserve, labMemory.productTarget || settings.productReserve);
        }
    }

    return reserve;
}

function getMinSellPrice(settings, resourceType) {
    if(settings.minSellPrices[resourceType] !== undefined) {
        return settings.minSellPrices[resourceType];
    }

    if(resourceType == RESOURCE_ENERGY) {
        return 0.001;
    }

    return settings.sellMinEffectivePrice;
}

function getMaxBuyPrice(settings, resourceType) {
    if(settings.maxBuyPrices[resourceType] !== undefined) {
        return settings.maxBuyPrices[resourceType];
    }

    if(resourceType == RESOURCE_ENERGY) {
        return settings.maxEnergyBuyPrice;
    }

    return settings.maxReagentBuyPrice;
}

function getTransactionCost(room, order, amount) {
    if(!order.roomName) {
        return null;
    }

    return Game.market.calcTransactionCost(amount, room.name, order.roomName);
}

function getOrders(type, resourceType) {
    return Game.market.getAllOrders({
        type: type,
        resourceType: resourceType
    });
}

function describeDeal(action, resourceType, amount, order, effectivePrice, cost) {
    return action + ' ' + amount + ' ' + resourceType +
        ' order=' + order.id +
        ' price=' + order.price +
        ' effective=' + Math.round(effectivePrice * 1000) / 1000 +
        ' txEnergy=' + cost;
}

function recordDeal(settings, message) {
    settings.lastDeal = {
        tick: Game.time,
        message: message
    };
}

function pickBestBuyOrder(room, terminal, settings, resourceType, surplus) {
    var orders = getOrders(ORDER_BUY, resourceType);
    var best = null;

    for(var i = 0; i < orders.length; i++) {
        var amount = Math.min(surplus, settings.maxDealAmount, orders[i].amount || 0);
        if(amount < settings.minDealAmount || orders[i].price <= 0) {
            continue;
        }

        var cost = getTransactionCost(room, orders[i], amount);
        if(cost === null ||
            cost > settings.maxTransactionEnergy ||
            terminal.store[RESOURCE_ENERGY] - cost < settings.minTerminalEnergy) {
            continue;
        }

        var effectivePrice = orders[i].price - cost * settings.energyCreditValue / amount;
        if(effectivePrice < getMinSellPrice(settings, resourceType)) {
            continue;
        }

        if(!best ||
            effectivePrice > best.effectivePrice ||
            (effectivePrice == best.effectivePrice && amount > best.amount)) {
            best = {
                order: orders[i],
                amount: amount,
                cost: cost,
                effectivePrice: effectivePrice
            };
        }
    }

    return best;
}

function sellSurplus(room, terminal, settings) {
    if(settings.sellSurplus === false) {
        return false;
    }

    for(var resourceType in terminal.store) {
        if(terminal.store[resourceType] <= 0 || resourceType == RESOURCE_ENERGY) {
            continue;
        }

        var reserve = getResourceReserve(room, settings, resourceType);
        var surplus = Math.min(
            terminal.store[resourceType],
            getStoredAmount(room, resourceType) - reserve
        );
        if(surplus < settings.minDealAmount) {
            continue;
        }

        var best = pickBestBuyOrder(room, terminal, settings, resourceType, surplus);
        if(!best) {
            continue;
        }

        var result = Game.market.deal(best.order.id, best.amount, room.name);
        if(result == OK) {
            var message = describeDeal('sold', resourceType, best.amount, best.order, best.effectivePrice, best.cost);
            recordDeal(settings, message);
            debug.log('debugMarket', room.name + ' market ' + message, 1);
            return true;
        }

        debug.log('debugMarket', room.name + ' market sell failed ' + resourceType + ': ' + result, 5);
        return false;
    }

    return false;
}

function getBuyNeed(room, settings, resourceType, below, target) {
    var stored = getStoredAmount(room, resourceType);
    if(stored >= below) {
        return 0;
    }

    return Math.max(0, target - stored);
}

function pickBestSellOrder(room, terminal, settings, resourceType, need) {
    var orders = getOrders(ORDER_SELL, resourceType);
    var best = null;
    var credits = Game.market.credits || 0;

    for(var i = 0; i < orders.length; i++) {
        var amount = Math.min(need, settings.maxDealAmount, orders[i].amount || 0);
        if(amount < settings.minDealAmount || orders[i].price <= 0) {
            continue;
        }

        var cost = getTransactionCost(room, orders[i], amount);
        if(cost === null ||
            cost > settings.maxTransactionEnergy ||
            terminal.store[RESOURCE_ENERGY] < cost) {
            continue;
        }

        if(resourceType != RESOURCE_ENERGY &&
            terminal.store[RESOURCE_ENERGY] - cost < settings.minTerminalEnergy) {
            continue;
        }

        var totalCredits = amount * orders[i].price;
        if(credits - totalCredits < settings.minCredits) {
            continue;
        }

        var effectivePrice = orders[i].price + cost * settings.energyCreditValue / amount;
        if(effectivePrice > getMaxBuyPrice(settings, resourceType)) {
            continue;
        }

        if(resourceType == RESOURCE_ENERGY && amount <= cost * 2) {
            continue;
        }

        if(!best ||
            effectivePrice < best.effectivePrice ||
            (effectivePrice == best.effectivePrice && amount > best.amount)) {
            best = {
                order: orders[i],
                amount: amount,
                cost: cost,
                effectivePrice: effectivePrice
            };
        }
    }

    return best;
}

function buyResource(room, terminal, settings, resourceType, need, label) {
    if(need < settings.minDealAmount) {
        return false;
    }

    var best = pickBestSellOrder(room, terminal, settings, resourceType, need);
    if(!best) {
        return false;
    }

    var result = Game.market.deal(best.order.id, best.amount, room.name);
    if(result == OK) {
        var message = describeDeal('bought ' + label, resourceType, best.amount, best.order, best.effectivePrice, best.cost);
        recordDeal(settings, message);
        debug.log('debugMarket', room.name + ' market ' + message, 1);
        return true;
    }

    debug.log('debugMarket', room.name + ' market buy failed ' + resourceType + ': ' + result, 5);
    return false;
}

function buyEnergy(room, terminal, settings) {
    if(settings.buyEnergy === false) {
        return false;
    }

    return buyResource(
        room,
        terminal,
        settings,
        RESOURCE_ENERGY,
        getBuyNeed(room, settings, RESOURCE_ENERGY, settings.buyEnergyBelow, settings.buyEnergyTarget),
        'energy'
    );
}

function buyLabReagents(room, terminal, settings) {
    if(settings.buyLabReagents === false) {
        return false;
    }

    var labPlan = getLabPlan(room);
    if(!labPlan) {
        return false;
    }

    var firstNeed = getBuyNeed(room, settings, labPlan.first, settings.buyReagentBelow, settings.buyReagentTarget);
    var secondNeed = getBuyNeed(room, settings, labPlan.second, settings.buyReagentBelow, settings.buyReagentTarget);

    if(firstNeed >= secondNeed) {
        return buyResource(room, terminal, settings, labPlan.first, firstNeed, 'reagent') ||
            buyResource(room, terminal, settings, labPlan.second, secondNeed, 'reagent');
    }

    return buyResource(room, terminal, settings, labPlan.second, secondNeed, 'reagent') ||
        buyResource(room, terminal, settings, labPlan.first, firstNeed, 'reagent');
}

function getRoomReport(room) {
    var settings = getSettings(room);
    var terminal = getTerminal(room);
    if(!terminal) {
        return room.name + ' market blockedBy=no terminal';
    }

    var labPlan = getLabPlan(room);
    var labText = labPlan ? ' lab=' + labPlan.first + '+' + labPlan.second + '->' + labPlan.product : '';
    var lastDeal = settings.lastDeal ?
        ' last=' + settings.lastDeal.tick + ' ' + settings.lastDeal.message :
        ' last=none';

    return room.name +
        ' market enabled=' + (settings.enabled !== false) +
        ' credits=' + Math.floor(Game.market.credits || 0) +
        ' terminalEnergy=' + (terminal.store[RESOURCE_ENERGY] || 0) +
        labText +
        lastDeal;
}

var marketManager = {
    getReport: function(roomName) {
        var lines = [];
        if(roomName) {
            var room = Game.rooms[roomName];
            return room ? getRoomReport(room) : roomName + ' market blockedBy=room not visible';
        }

        for(var name in Game.rooms) {
            if(Game.rooms[name].controller && Game.rooms[name].controller.my) {
                lines.push(getRoomReport(Game.rooms[name]));
            }
        }

        return lines.sort().join('\n');
    },

    run: function(room) {
        if(!room.controller || !room.controller.my) {
            return;
        }

        var settings = getSettings(room);
        var terminal = getTerminal(room);
        if(!terminal ||
            terminal.cooldown > 0 ||
            !shouldRun(room, settings)) {
            return;
        }

        if(buyEnergy(room, terminal, settings)) {
            return;
        }

        if(buyLabReagents(room, terminal, settings)) {
            return;
        }

        sellSurplus(room, terminal, settings);
    }
};

module.exports = marketManager;

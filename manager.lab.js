var debug = require('utils.debug');

function formatPos(pos) {
    return pos.roomName + ':' + pos.x + ',' + pos.y;
}

function getLabs(room) {
    return room.find(FIND_MY_STRUCTURES, {
        filter: function(structure) {
            return structure.structureType == STRUCTURE_LAB;
        }
    });
}

function getLoadedLabs(labs) {
    var loaded = [];
    var reactionAmount = typeof LAB_REACTION_AMOUNT === 'undefined' ? 5 : LAB_REACTION_AMOUNT;
    for(var i = 0; i < labs.length; i++) {
        if(labs[i].mineralType &&
            labs[i].store[labs[i].mineralType] >= reactionAmount) {
            loaded.push(labs[i]);
        }
    }

    return loaded;
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

function findReactionPair(labs) {
    var loaded = getLoadedLabs(labs);
    for(var i = 0; i < loaded.length; i++) {
        for(var j = 0; j < loaded.length; j++) {
            if(i == j) {
                continue;
            }

            var product = getReactionProduct(loaded[i].mineralType, loaded[j].mineralType);
            if(product) {
                return {
                    first: loaded[i],
                    second: loaded[j],
                    product: product
                };
            }
        }
    }

    return null;
}

function runOutputLabs(room, labs, pair) {
    var ran = 0;
    for(var i = 0; i < labs.length; i++) {
        if(labs[i].id == pair.first.id ||
            labs[i].id == pair.second.id ||
            labs[i].cooldown > 0) {
            continue;
        }

        if(labs[i].mineralType && labs[i].mineralType != pair.product) {
            continue;
        }

        var result = labs[i].runReaction(pair.first, pair.second);
        if(result == OK) {
            ran++;
            debug.log(
                'debugRoles',
                room.name + ' lab reaction ' + pair.first.mineralType + '+' +
                    pair.second.mineralType + ' -> ' + pair.product +
                    ' at ' + formatPos(labs[i].pos),
                5
            );
        }
        else if(result != ERR_TIRED && result != ERR_NOT_ENOUGH_RESOURCES) {
            debug.log('debugRoles', room.name + ' lab reaction failed: ' + result, 10);
        }
    }

    return ran;
}

var labManager = {
    run: function(room) {
        if(!room.controller || !room.controller.my || room.controller.level < 6) {
            return;
        }

        var labs = getLabs(room);
        if(labs.length < 3) {
            return;
        }

        var pair = findReactionPair(labs);
        if(!pair) {
            debug.log('debugRoles', room.name + ' labs idle; no loaded reaction pair', 50);
            return;
        }

        runOutputLabs(room, labs, pair);
    }
};

module.exports = labManager;

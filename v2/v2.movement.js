var config = require('v2.config');
var memory = require('v2.memory');
var utils = require('v2.utils');

function addUsage(bucket, pos, amount) {
    var root = memory.getMemory();
    if(!root[bucket][pos.roomName]) {
        root[bucket][pos.roomName] = {};
    }

    var key = utils.posKey(pos);
    root[bucket][pos.roomName][key] = (root[bucket][pos.roomName][key] || 0) + (amount || 1);
}

function recordRoadUsage(creep) {
    if(utils.hasStructure(creep.pos, STRUCTURE_ROAD)) {
        addUsage('roadUsage', creep.pos, 1);
    }
}

function moveTo(creep, target, range) {
    return creep.moveTo(target, {
        reusePath: 20,
        range: range === undefined ? 1 : range,
        visualizePathStyle: {
            stroke: '#ffaa00'
        },
        routeCallback: function(roomName) {
            return memory.isRoomHostile(roomName) ? Infinity : 1;
        }
    });
}

function recordActualMovement(creep) {
    if(!creep.memory.lastPos) {
        creep.memory.lastPos = utils.packPos(creep.pos);
        return;
    }

    var lastPos = utils.unpackPos(creep.memory.lastPos);
    if(lastPos.roomName != creep.pos.roomName ||
        lastPos.x != creep.pos.x ||
        lastPos.y != creep.pos.y) {
        addUsage('pathUsage', creep.pos, 1);
        addUsage('pathUsage', lastPos, 0.35);
    }

    creep.memory.lastPos = utils.packPos(creep.pos);
}

function decayBucket(bucketName, decay) {
    var root = memory.getMemory();
    for(var roomName in root[bucketName]) {
        var usage = root[bucketName][roomName];
        for(var key in usage) {
            usage[key] = usage[key] * decay;
            if(usage[key] < 0.2) {
                delete usage[key];
            }
        }
    }
}

function decayUsage() {
    decayBucket('roadUsage', config.roadUsageDecay);
    decayBucket('pathUsage', config.pathUsageDecay);
}

module.exports = {
    moveTo: moveTo,
    recordRoadUsage: recordRoadUsage,
    recordActualMovement: recordActualMovement,
    decayUsage: decayUsage
};

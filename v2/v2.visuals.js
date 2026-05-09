var config = require('v2.config');
var construction = require('v2.construction');
var intel = require('v2.intel');
var memory = require('v2.memory');
var tasks = require('v2.tasks');
var utils = require('v2.utils');

function heatColor(value, maxValue) {
    if(maxValue <= 0) {
        return '#3355ff';
    }

    var ratio = Math.max(0, Math.min(1, value / maxValue));
    if(ratio < 0.4) {
        return '#33ccff';
    }
    if(ratio < 0.75) {
        return '#ffe066';
    }
    return '#ff5555';
}

function drawUsageBucket(bucketName, roomOpacity, mapOpacity, mapRadius) {
    var root = memory.getMemory();
    for(var roomName in root[bucketName]) {
        var room = Game.rooms[roomName];
        var usage = root[bucketName][roomName];
        var maxValue = 0;

        for(var key in usage) {
            maxValue = Math.max(maxValue, usage[key]);
        }

        for(var posKeyString in usage) {
            var parts = posKeyString.split(':');
            var pos = new RoomPosition(parseInt(parts[0], 10), parseInt(parts[1], 10), roomName);
            var color = heatColor(usage[posKeyString], maxValue);
            var radius = 0.16 + Math.min(0.34, usage[posKeyString] / Math.max(1, maxValue) * 0.34);

            if(room) {
                room.visual.circle(pos, {
                    radius: radius,
                    fill: color,
                    opacity: roomOpacity,
                    stroke: color,
                    strokeWidth: 0.04
                });
            }

            if(config.mapVisualEnabled &&
                Game.map.visual &&
                typeof Game.map.visual.circle == 'function') {
                Game.map.visual.circle(pos, {
                    radius: mapRadius,
                    fill: color,
                    opacity: mapOpacity,
                    stroke: color,
                    strokeWidth: 0.1
                });
            }
        }
    }
}

function drawRoadIntents() {
    for(var roomName in Game.rooms) {
        var room = Game.rooms[roomName];
        var intents = construction.getRoadIntentPositions(room);
        for(var i = 0; i < intents.length; i++) {
            room.visual.circle(intents[i], {
                radius: 0.13,
                fill: '#66ccff',
                opacity: 0.15,
                stroke: '#66ccff',
                strokeWidth: 0.02
            });
        }
    }
}

function getRoomStats() {
    var stats = {
        safe: 0,
        hostile: 0,
        unknown: 0,
        sources: 0
    };
    var root = memory.getMemory();

    for(var roomName in root.rooms) {
        var roomMemory = root.rooms[roomName];
        if(memory.isRoomHostile(roomName)) {
            stats.hostile++;
        }
        else if(roomMemory.status == 'safe' || roomMemory.status == 'owned') {
            stats.safe++;
            stats.sources += roomMemory.sources ? roomMemory.sources.length : 0;
        }
        else {
            stats.unknown++;
        }
    }

    return stats;
}

function getSourceAssignmentLines(limit) {
    var sourceTasks = tasks.getSourceSlotTasks();
    sourceTasks.sort(function(a, b) {
        return tasks.getTaskSpawnDistance(a) - tasks.getTaskSpawnDistance(b) ||
            a.roomName.localeCompare(b.roomName);
    });

    var lines = [];
    for(var i = 0; i < sourceTasks.length && lines.length < limit; i++) {
        lines.push(
            sourceTasks[i].roomName +
            ' ' + tasks.countAssignedMiners(sourceTasks[i].id) + '/1' +
            ' d' + tasks.getTaskSpawnDistance(sourceTasks[i])
        );
    }

    return lines;
}

function drawDebugPanel() {
    var roleStats = tasks.getRoleStats();
    var roomStats = getRoomStats();
    var unknownTargets = intel.getUnknownScoutTargets().length;
    var sourceLines = getSourceAssignmentLines(6);
    var rooms = utils.getOwnedRoomsWithSpawns();

    for(var i = 0; i < rooms.length; i++) {
        var room = rooms[i];
        var lines = [
            'v2 rush',
            'miners ' + roleStats.miners + '/' + tasks.desiredMinerCount() +
                ' assigned ' + roleStats.minersAssigned,
            'collectors ' + roleStats.collectors + '/' + tasks.desiredCollectorCount() +
                ' carrying ' + roleStats.collectorsFull,
            'scouts ' + roleStats.scouts + '/' + config.maxScouts +
                ' unknown ' + unknownTargets,
            'rooms safe ' + roomStats.safe +
                ' hostile ' + roomStats.hostile +
                ' unknown ' + roomStats.unknown,
            'source slots ' + tasks.sourceWorkerDemand(),
            'pickup energy ' + tasks.getCollectableEnergyAmount()
        ];

        for(var s = 0; s < sourceLines.length; s++) {
            lines.push(sourceLines[s]);
        }

        room.visual.rect(0.6, 0.25, 17.4, lines.length * 0.82 + 0.55, {
            fill: '#111111',
            opacity: 0.45,
            stroke: '#66ccff',
            strokeWidth: 0.05
        });

        for(var lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            room.visual.text(lines[lineIndex], 1, 1 + lineIndex * 0.82, {
                align: 'left',
                color: lineIndex === 0 ? '#66ccff' : '#ffffff',
                font: lineIndex === 0 ? 0.65 : 0.48,
                opacity: 0.95
            });
        }
    }
}

function draw() {
    drawUsageBucket('pathUsage', 0.22, 0.18, 0.65);
    drawUsageBucket('roadUsage', 0.5, 0.28, 0.85);
    drawRoadIntents();
    drawDebugPanel();
}

module.exports = {
    draw: draw
};

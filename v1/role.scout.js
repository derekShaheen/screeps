var creepUtils = require('utils.creep');
var remoteManager = require('manager.remote');

module.exports = {
    run: function(creep) {
        var homeName = creep.memory.homeRoom || (creep.memory.homeRoom = creep.room.name);
        var home = Game.rooms[homeName];
        if(!home) { return; }
        var settings = remoteManager.getSettings(home);
        // Record danger in the room actually visited before choosing another target.
        if(remoteManager.hasThreats(creep.room) || remoteManager.hasHostileTower(creep.room)) {
            if(creep.room.name != homeName) {
                remoteManager.markUnsafe(homeName, creep.room.name,
                    remoteManager.hasHostileTower(creep.room) ? 'hostile tower' : 'combat hostile');
            }
            delete creep.memory.targetRoom;
            delete creep.memory.scoutMission;
            return remoteManager.moveHome(creep, 'scoutRetreat');
        }
        var target = remoteManager.getScoutTarget(homeName, creep.memory.targetRoom);
        if(!target) {
            delete creep.memory.targetRoom;
            delete creep.memory.scoutMission;
            return remoteManager.moveHome(creep, 'scoutHome');
        }
        var mission = creep.memory.scoutMission;
        var position = creep.room.name + ':' + creep.pos.x + ':' + creep.pos.y;
        if(!mission || mission.target != target) {
            mission = creep.memory.scoutMission = {target: target, started: Game.time,
                progress: Game.time, position: position, failures: 0};
            delete creep.memory._move;
            delete creep.memory.remoteRoute;
        }
        creep.memory.targetRoom = target;
        if(mission.position != position) {
            mission.position = position;
            mission.progress = Game.time;
        }
        if(creep.fatigue > 0) { mission.progress = Game.time; return; }
        var result = remoteManager.moveToRoom(creep, target, '#88ddff', 'scout', 'move:scoutRoom');
        mission.failures = result == ERR_NO_PATH ? mission.failures + 1 : 0;
        if(mission.failures >= 3 || Game.time - mission.progress >= settings.scoutStuckTicks ||
            Game.time - mission.started >= settings.scoutMissionTicks) {
            remoteManager.failScoutTarget(homeName, target,
                result == ERR_NO_PATH ? 'no route' : 'mission made no timely progress');
            delete creep.memory.targetRoom;
            delete creep.memory.scoutMission;
            delete creep.memory._move;
            delete creep.memory.remoteRoute;
        }
    }
};

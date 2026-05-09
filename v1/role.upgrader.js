var creepUtils = require('utils.creep');

var roleUpgrader = {
    run: function(creep) {
        creepUtils.updateWorkingState(creep, 'upgrade', 'energy');

        if(creep.memory.working) {
            creepUtils.upgrade(creep);
            return;
        }

        creepUtils.collectEnergy(creep);
    }
};

module.exports = roleUpgrader;

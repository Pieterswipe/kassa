const { proxy } = require('./_proxy');

exports.handler = async (event) => proxy(event, 'updateUserInQR');

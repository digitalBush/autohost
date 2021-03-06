var request;

function HttpEnvelope( req, res ) {
	this.transport = 'http';
	this.context = req.context;
	this.data = req.body || {};
	this.path = req.url;
	this.cookies = req.cookies;
	this.headers = req.headers;
	this.params = {};
	this.files = req.files;
	this.user = req.user;
	this.responseStream = res;
	this._original = {
		req: req,
		res: res
	};

	[req.params, req.query].forEach(function(source){
		Object.keys(source).forEach(function(key){
			var val = source[ key ];
			if( !this.data[ key ] ) {
				this.data[ key ] = val;
			}
			this.params[ key ] = val;
		}.bind(this));
	}.bind(this));
}

HttpEnvelope.prototype.forwardTo = function( options ) {
	return this._original.req.pipe( request( options ) );
};

HttpEnvelope.prototype.reply = function( envelope ) {
	var code = envelope.statusCode || 200;
	this._original.res.status( code ).send( envelope.data );
};

HttpEnvelope.prototype.replyWithFile = function( contentType, fileName, fileStream ) {
	this._original.res.set( {
			'Content-Disposition': 'attachment; filename="' + fileName + '"',
			'Content-Type': contentType
		} );
	fileStream.pipe( this._original.res );
};

module.exports = function( request ) {
	request = request;
	return HttpEnvelope;
};
var restify = require('restify');
var _ = require('underscore');
var fs = require('fs');

var http_port = '80';
var https_port = '443';


var http_server = restify.createServer({
  name:'http_restplatform'
});

var https_server = restify.createServer({
  name:'https_restplatform',
  key: fs.readFileSync('/home/ubuntu/ssl/server.key'),
  certificate: fs.readFileSync('/home/ubuntu/ssl/server.crt')
});

initServer(http_server);
initServer(https_server);

http_server.listen(http_port,function(){
  console.log('%s listening at %s',server.name,server.url);
});

https_server.listen(https_port,function(){
  console.log('%s listening at %s',server.name,server.url);
});


function initServer(server){
  
  server.use(restify.acceptParser(server.acceptable));
  server.use(restify.authorizationParser());
  server.use(restify.dateParser());
  server.use(restify.queryParser());
  server.use(restify.jsonp());
  server.use(restify.gzipResponse());
  server.use(restify.bodyParser());


  server.get({path:'/passws/'},function (req, res, next){
    console.log('Handling index request...');
    res.send(200,{ok:1});
    return next();
  });

  server.post({path:'/passws/v1/devices/:device_id/registrations/:pass_type_id/:serial_number'},function (req, res, next){
    console.log('Handling registration request...');
    console.log("#<RegistrationRequest device_id: " + req.params.device_id +
      ", pass_type_id: " + req.params.pass_type_id +
      ", serial_number: " + req.params.serial_number +
      ", authentication_token: " + req.header('Authorization') +
      ", push_token: " + req.params.pushToken+">");
    res.status(200);
    return next();
  });

  server.get({path:'/passws/v1/devices/:device_id/registrations/:pass_type_id?'},function (req, res, next){
    console.log('Handling updates request...');
    res.status(204);
    return next();
  });

  server.del({path:'/passws/v1/devices/:device_id/registrations/:pass_type_id/:serial_number'},function (req, res, next){
    console.log('Handling unregistration request...')
    res.status(200);
    return next();
  });

  server.get({path:'/passws/v1/passes/:pass_type_id/:serial_number'},function (req, res, next){
    console.log('Handling pass delivery request...');
    res.status(401);
    return next();
  });

  server.post({path:'passws/v1/log'},function (req, res, next){
    console.log('Handling log request...');
    console.log('#<LogRequest logs: '+req.params.logs+">");
    res.status(200);
    return next();
  });
}

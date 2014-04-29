var restify = require('restify');
var _ = require('underscore');
var fs = require('fs');
var mongojs = require('mongojs');
var createTemplate = require("passbook");

var mongoConnection = 'mongodb://smartplaces:EvystVtcnf@oceanic.mongohq.com:10091/smartplaces'; // || process.env.MONGOHQ_URL || 'localhost:3001/smartplaces';
var db = mongojs(mongoConnection,['smartplaces']);
var passes = db.collection('passes');

var http_port = process.env.PORT || '8080';
var https_port = '443';

var KEYS_FOLDER = "./keys/";
var KEYS_PASSWORD = "123456";
var IMAGE_FOLDER = "./images"

var http_server = restify.createServer({
  name:'http_restplatform'
});

initServer(http_server);

http_server.listen(http_port,function(){
  console.log('%s listening at %s',http_server.name,http_server.url);
});

function samplePassJSON(){
  return {
    formatVersion: 1,
    passTypeIdentifier: "pass.ru.smartplaces.coupon",
    teamIdentifier:     "Y77QB88576",
    webServiceURL: "http://sleepy-scrubland-4869.herokuapp.com/passws/",
    authenticationToken: "10AA10AA10AA10AA10AA10AA10AA10AA10AA10AA",
    organizationName: "SmartPlaces",
    description:   "Купон от SmartPlaces",
    backgroundColor:   "rgb(237,216,216)",
    foregroundColor: "rgb(247,7,65)",
    labelColor: "rgb(13,21,237)",

    serialNumber:  "SN"+new Date().getTime(),

    logoText: "Smar Coffe",

    barcode : {
      message : "1234567",
      format : "PKBarcodeFormatPDF417",
      messageEncoding : "utf-8"
    },

    coupon: {
      primaryFields : [
        {
          key : "offer",
          label : "-50%",
          value : "на американо"
        }
      ],
      secondaryFields : [
        {
          key : "addInfo",
          label : "Предложение для",
          value : "Всех посетителей"
        }
      ],
      backFields : [
        {
          "key" : "terms",
          "label" : "УСЛОВИЯ ИСПОЛЬЗОВАНИЯ",
          "value" : "Это купон создан компанией SmartPlaces и является ее собственностью."
        }
      ]
    }
  };
}

function createSamplePass(){
  var template = createTemplate("coupon", {});

  template.keys(KEYS_FOLDER, KEYS_PASSWORD);

  var json = samplePassJSON();

  var pass = template.createPass(json);

  pass.loadImagesFrom(IMAGE_FOLDER);

  pass.on("error", function(error) {
    console.error(error);
  });

  pass.on('end',function(){
    console.log('Pass with serial number '+json.serialNumber+' was created.');
  });

  // store pass to database
  passes.save({pass:json});

  return pass;
}

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
    fs.readFile('./index.html','utf-8',function(err,data){
      if (err) {
        res.status(404);
        return next();
      }else{
        res.writeHead(200, {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Content-Length': Buffer.byteLength(data),
          'Content-Type': 'text/html'
        });
        res.write(data);
        res.end();
        return next();
      }
    });
  });

  server.get({path:'/passws/getSamplePass/:pass_name'},function (req, res, next){
    var pass = createSamplePass();
    res.writeHead(200,{
      'Content-Type': 'application/vnd.apple.pkpass',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    })
    pass.render(res, function(error) {
      if (error)
        console.error(error);
      return next();
    });
  });

  server.post({path:'/passws/v1/devices/:device_id/registrations/:pass_type_id/:serial_number'},function (req, res, next){
    try{
      console.log('Handling registration request...');

      var authToken = req.header('Authorization');
      if (authToken) authToken = authToken.replace('ApplePass ','');
      var serialNumber = req.params.serial_number;
      var passType = req.params.pass_type_id;
      var deviceId = req.params.device_id;
      var pushToken = req.params.pushToken;

      console.log(authToken+","+serialNumber+","+passType+","+deviceId+","+pushToken);

      passes.findOne({'pass.passTypeIdentifier':passType,'pass.serialNumber':serialNumber,'pass.authenticationToken':authToken}, function (err,pass){
        if (pass){
          console.log('Pass for device was found!');
          if (_.indexOf(pass.registrations,deviceId) > -1){
            res.status(200);
            return next();
          }else{
            passes.update({_id:pass._id},{$addToSet:{registrations:{deviceId:deviceId,pushToken:pushToken}}},{},function(err){
                if (err){
                  res.status(500);
                  return next();
                }else{
                  res.status(201);
                  return next();
                }
            });
          }
        }else{
          console.log('Pass for device wasn\'t found!');
          res.status(401);
          return next();
        }
      });
    }catch(ex){
      console.log(ex);
      res.status(200);
      return next();
    }

  });

  server.get({path:'/passws/v1/devices/:device_id/registrations/:pass_type_id?'},function (req, res, next){
    console.log('Handling updates request...');

    var passType = req.params.pass_type_id;
    var deviceId = req.params.device_id;
    var passesUpdatedSince = req.params.passesUpdatedSince;


    passes.find({'registrations.deviceId':deviceId},function(err,docs){
      if (docs.length>0){
        var result = {
          lastUpdated: new Date().getTime(),
          serialNumbers: []
        }
        _.each(docs,function(d){
          if (d.passType === passType){
            if (passesUpdatedSince){
              if (!d.updatedAt || d.updatedAt > passesUpdatedSince){
                result.serialNumbers.append(d.serialNumber);
              }
            }else{
              result.serialNumbers.append(d.serialNumber);
            }
          }
        });

        if (result.serialNumbers.length > 0){
          res.send(200,result);
          return next();
        }else{
          res.status(204);
          return next();
        }

      }else{
        res.status(404);
        return next();
      }
    });
  });

  server.del({path:'/passws/v1/devices/:device_id/registrations/:pass_type_id/:serial_number'},function (req, res, next){
    console.log('Handling unregistration request...')

    var authToken = req.header('Authorization');
    if (authToken) authToken = authToken.replace('ApplePass ','');
    var serialNumber = req.params.serial_number;
    var passType = req.params.pass_type_id;
    var deviceId = req.params.device_id;

    passes.remove({'pass.authenticationToken':authToken, 'pass.serialNumber':serialNumber, 'pass.passTypeIdentifier':passType, 'registrations.deviceId':deviceId},function(err,count){
      if (count > 0){
        res.status(200);
      }else{
        res.status(401);
      }
      return next();
    });
  });

  server.get({path:'/passws/v1/passes/:pass_type_id/:serial_number'},function (req, res, next){
    console.log('Handling pass delivery request...');

    var authToken = req.header('Authorization');
    if (authToken) authToken = authToken.replace('ApplePass ','');
    var serialNumber = req.params.serial_number;
    var passType = req.params.pass_type_id;

    passes.findOne({'pass.authenticationToken':authToken,'pass.serialNumber':serialNumber,'pass.passTypeIdentifier':passType},function(err,pass){
      if (pass){
        // Send pass-file to response with mime type: 'application/vnd.apple.pkpass'
        res.status(200);
        return next();
      }else{
        res.status(401);
        return next();
      }
    });


  });

  server.post({path:'passws/v1/log'},function (req, res, next){
    console.log('Handling log request...');
    var logs = req.params.logs;
    _.each(logs,function(log){
      db.collection('passbook_logs').insert({m:log});
    });
    res.status(200);
    return next();
  });
}

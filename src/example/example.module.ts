import { Module } from '@nestjs/common';
import { ExampleController } from './example.controller';
import { ExampleService } from './example.service';

/**
 * The reference module: copy this folder to add a feature (see `README.md` here).
 * When you start a real project, delete it together with the `ExampleItem` model.
 */
@Module({
  controllers: [ExampleController],
  providers: [ExampleService],
})
export class ExampleModule {}
